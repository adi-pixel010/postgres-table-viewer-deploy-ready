# Build the ASP.NET Core API with .NET 10.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY PostgresTableViewer.Api.csproj ./
RUN dotnet restore PostgresTableViewer.Api.csproj
COPY . ./
RUN dotnet publish PostgresTableViewer.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

# Small runtime image for production.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish ./
EXPOSE 10000
# Render provides PORT (normally 10000); bind on all interfaces inside the container.
ENTRYPOINT ["sh", "-c", "dotnet PostgresTableViewer.Api.dll --urls http://0.0.0.0:${PORT:-10000}"]
