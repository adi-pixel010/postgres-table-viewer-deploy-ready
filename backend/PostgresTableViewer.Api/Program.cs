using System.Globalization;
using System.Text;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Postgres");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        "Missing ConnectionStrings:Postgres. Set it in appsettings.json or via the ConnectionStrings__Postgres environment variable.");
}

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var frontendOrigin = builder.Configuration["FrontendOrigin"] ?? "http://localhost:5173";
builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy => policy
        .WithOrigins(frontendOrigin)
        .AllowAnyHeader()
        .AllowAnyMethod());
});

var app = builder.Build();

if (app.Environment.IsDevelopment() || builder.Configuration.GetValue<bool>("EnableSwagger"))
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("frontend");

app.MapGet("/api/health", async (NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT 1", connection);
        await command.ExecuteScalarAsync(cancellationToken);
        return (IResult)Results.Ok(new { status = "ok", database = "connected" });
    }
    catch
    {
        return Results.Problem(
            title: "PostgreSQL connection failed",
            detail: "Check the backend connection string and confirm PostgreSQL is reachable.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

// Only ordinary tables in non-system schemas are returned to the UI.
app.MapGet("/api/tables", async (NpgsqlDataSource dataSource, CancellationToken cancellationToken) =>
{
    await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
    const string sql = """
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
          AND left(table_schema, 3) <> 'pg_'
        ORDER BY table_schema, table_name;
        """;

    await using var command = new NpgsqlCommand(sql, connection);
    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
    var tables = new List<object>();

    while (await reader.ReadAsync(cancellationToken))
    {
        var schema = reader.GetString(0);
        var name = reader.GetString(1);
        tables.Add(new { schema, name, displayName = $"{schema}.{name}" });
    }

    return Results.Ok(tables);
});

// API parameter: tableName only. All matching rows are returned; the browser paginates locally.
app.MapGet("/api/table-data", async (
    string tableName,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(tableName))
    {
        return (IResult)Results.BadRequest(new { message = "The tableName query parameter is required." });
    }

    await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
    var matches = await FindTablesByNameAsync(connection, tableName.Trim(), cancellationToken);

    if (matches.Count == 0)
    {
        return (IResult)Results.NotFound(new { message = $"No accessible PostgreSQL table named '{tableName}' was found." });
    }

    if (matches.Count > 1)
    {
        return (IResult)Results.Conflict(new
        {
            message = $"More than one accessible table is named '{tableName}'. Pass a schema-qualified value such as 'public.{tableName}' in the tableName parameter."
        });
    }

    var (schema, table) = matches[0];
    var qualifiedTable = $"{QuoteIdentifier(schema)}.{QuoteIdentifier(table)}";
    await using var dataCommand = new NpgsqlCommand($"SELECT * FROM {qualifiedTable};", connection);
    await using var reader = await dataCommand.ExecuteReaderAsync(cancellationToken);

    var columns = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToArray();
    var rows = new List<Dictionary<string, object?>>();

    while (await reader.ReadAsync(cancellationToken))
    {
        var row = new Dictionary<string, object?>(StringComparer.Ordinal);
        for (var i = 0; i < reader.FieldCount; i++)
        {
            row[columns[i]] = await reader.IsDBNullAsync(i, cancellationToken)
                ? null
                : reader.GetValue(i);
        }
        rows.Add(row);
    }

    return (IResult)Results.Ok(new { schema, table, columns, rows, totalCount = rows.Count });
});

// Exports the entire selected table as UTF-8 CSV. API parameter: tableName only.
app.MapGet("/api/table-data/csv", async (
    string tableName,
    NpgsqlDataSource dataSource,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(tableName))
    {
        return (IResult)Results.BadRequest(new { message = "The tableName query parameter is required." });
    }

    string schema;
    string table;
    await using (var validationConnection = await dataSource.OpenConnectionAsync(cancellationToken))
    {
        var matches = await FindTablesByNameAsync(validationConnection, tableName.Trim(), cancellationToken);
        if (matches.Count == 0)
        {
            return (IResult)Results.NotFound(new { message = $"No accessible PostgreSQL table named '{tableName}' was found." });
        }

        if (matches.Count > 1)
        {
            return (IResult)Results.Conflict(new
            {
                message = $"More than one accessible table is named '{tableName}'. Pass a schema-qualified value such as 'public.{tableName}' in the tableName parameter."
            });
        }

        (schema, table) = matches[0];
    }

    var qualifiedTable = $"{QuoteIdentifier(schema)}.{QuoteIdentifier(table)}";
    var fileName = $"{SafeFilePart(table)}.csv";

    return (IResult)Results.Stream(async outputStream =>
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand($"SELECT * FROM {qualifiedTable};", connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await using var writer = new StreamWriter(outputStream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true), 4096, leaveOpen: true);

        var columnNames = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToArray();
        await writer.WriteLineAsync(string.Join(",", columnNames.Select(EscapeCsv)));

        while (await reader.ReadAsync(cancellationToken))
        {
            var cells = new string[reader.FieldCount];
            for (var i = 0; i < reader.FieldCount; i++)
            {
                if (await reader.IsDBNullAsync(i, cancellationToken))
                {
                    cells[i] = string.Empty;
                    continue;
                }

                var value = reader.GetValue(i);
                var text = FormatCsvValue(value);
                // Guard text cells against spreadsheet formula injection when opened in Excel/Calc.
                if (reader.GetFieldType(i) == typeof(string))
                {
                    text = PreventFormulaInjection(text);
                }
                cells[i] = EscapeCsv(text);
            }

            await writer.WriteLineAsync(string.Join(",", cells));
        }

        await writer.FlushAsync();
    }, contentType: "text/csv; charset=utf-8", fileDownloadName: fileName);
});

app.Run();

static async Task<List<(string Schema, string Table)>> FindTablesByNameAsync(
    NpgsqlConnection connection,
    string tableName,
    CancellationToken cancellationToken)
{
    // A schema-qualified value (for example, "public.mock_data") still uses the single tableName parameter
    // while allowing a table to be selected unambiguously when schemas contain the same table name.
    var separator = tableName.IndexOf('.');
    if (separator > 0 && separator < tableName.Length - 1)
    {
        const string qualifiedSql = """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema = @schema
              AND table_name = @table
              AND table_type = 'BASE TABLE'
              AND table_schema NOT IN ('pg_catalog', 'information_schema')
              AND left(table_schema, 3) <> 'pg_';
            """;

        await using var qualifiedCommand = new NpgsqlCommand(qualifiedSql, connection);
        qualifiedCommand.Parameters.AddWithValue("schema", tableName[..separator]);
        qualifiedCommand.Parameters.AddWithValue("table", tableName[(separator + 1)..]);
        await using var qualifiedReader = await qualifiedCommand.ExecuteReaderAsync(cancellationToken);
        var qualifiedMatches = new List<(string Schema, string Table)>();
        while (await qualifiedReader.ReadAsync(cancellationToken))
        {
            qualifiedMatches.Add((qualifiedReader.GetString(0), qualifiedReader.GetString(1)));
        }

        if (qualifiedMatches.Count > 0)
        {
            return qualifiedMatches;
        }
    }

    const string sql = """
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_name = @tableName
          AND table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
          AND left(table_schema, 3) <> 'pg_'
        ORDER BY table_schema;
        """;

    await using var command = new NpgsqlCommand(sql, connection);
    command.Parameters.AddWithValue("tableName", tableName);
    await using var reader = await command.ExecuteReaderAsync(cancellationToken);

    var matches = new List<(string Schema, string Table)>();
    while (await reader.ReadAsync(cancellationToken))
    {
        matches.Add((reader.GetString(0), reader.GetString(1)));
    }

    return matches;
}

// PostgreSQL identifiers cannot be SQL parameters; quote metadata-validated identifiers before use.
static string QuoteIdentifier(string identifier) => "\"" + identifier.Replace("\"", "\"\"") + "\"";

static string FormatCsvValue(object value) => value switch
{
    DateTime dateTime => dateTime.ToString("O", CultureInfo.InvariantCulture),
    DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("O", CultureInfo.InvariantCulture),
    DateOnly dateOnly => dateOnly.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
    TimeOnly timeOnly => timeOnly.ToString("HH:mm:ss.fffffff", CultureInfo.InvariantCulture),
    byte[] bytes => Convert.ToBase64String(bytes),
    IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture) ?? string.Empty,
    _ => value.ToString() ?? string.Empty
};

static string PreventFormulaInjection(string value)
{
    var firstNonWhitespace = value.AsSpan().TrimStart();
    if (!firstNonWhitespace.IsEmpty && "=+-@\t\r".Contains(firstNonWhitespace[0]))
    {
        return "'" + value;
    }
    return value;
}

static string EscapeCsv(string value)
{
    if (value.Contains(',') || value.Contains('"') || value.Contains('\r') || value.Contains('\n'))
    {
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
    return value;
}

static string SafeFilePart(string value)
{
    var safe = new string(value.Select(character =>
        char.IsLetterOrDigit(character) || character is '-' or '_' ? character : '_').ToArray());
    return string.IsNullOrWhiteSpace(safe) ? "table" : safe;
}
