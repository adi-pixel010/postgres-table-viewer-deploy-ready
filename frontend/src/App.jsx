import { useEffect, useState } from 'react';

const PAGE_SIZE = 50;

// Set VITE_API_BASE_URL in Netlify to the deployed API URL. Leave empty locally
// so Vite's development proxy continues to route /api requests to localhost:5080.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const apiUrl = (path) => `${API_BASE_URL}${path}`;

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (name === 'table') {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16M15 10v10" /></svg>;
  }
  if (name === 'download') {
    return <svg {...common}><path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M5 16v4h14v-4" /></svg>;
  }
  if (name === 'refresh') {
    return <svg {...common}><path d="M20 7v5h-5" /><path d="M4.9 9A7.5 7.5 0 0 1 18 6l2 6M4 17v-5h5" /><path d="M19.1 15A7.5 7.5 0 0 1 6 18l-2-6" /></svg>;
  }
  if (name === 'database') {
    return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
  }
  if (name === 'chevron') {
    return <svg {...common}><path d="m7 10 5 5 5-5" /></svg>;
  }
  if (name === 'search') {
    return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>;
  }
  return null;
}

async function readError(response) {
  try {
    const body = await response.json();
    return body.detail || body.message || body.title || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

function formatCell(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function App() {
  const [activeView, setActiveView] = useState('home');
  const [tables, setTables] = useState([]);
  const [tablesLoaded, setTablesLoaded] = useState(false);
  const [selectedTable, setSelectedTable] = useState(null);
  const [tableData, setTableData] = useState(null);
  const [page, setPage] = useState(0);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [health, setHealth] = useState('checking');

  useEffect(() => {
    let ignore = false;
    fetch(apiUrl('/api/health'))
      .then((response) => {
        if (!response.ok) throw new Error('offline');
        return response.json();
      })
      .then(() => { if (!ignore) setHealth('connected'); })
      .catch(() => { if (!ignore) setHealth('offline'); });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    if (activeView !== 'tables' || !selectedTable) {
      setTableData(null);
      return undefined;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ tableName: selectedTable.displayName || `${selectedTable.schema}.${selectedTable.name}` });

    async function loadData() {
      setLoadingData(true);
      setError('');
      setNotice('');
      try {
        const response = await fetch(apiUrl(`/api/table-data?${query.toString()}`), { signal: controller.signal });
        if (!response.ok) throw new Error(await readError(response));
        const data = await response.json();
        setTableData(data);
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setTableData(null);
          setError(loadError.message || 'Unable to load table data.');
        }
      } finally {
        if (!controller.signal.aborted) setLoadingData(false);
      }
    }

    loadData();
    return () => controller.abort();
  }, [activeView, selectedTable]);

  async function openTables(forceRefresh = false) {
    setActiveView('tables');
    setNotice('');
    setError('');
    if (tablesLoaded && !forceRefresh) return;

    setLoadingTables(true);
    try {
      const response = await fetch(apiUrl('/api/tables'));
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json();
      setTables(result);
      setTablesLoaded(true);
      if (result.length === 0) setNotice('No accessible tables were found in your non-system PostgreSQL schemas.');
    } catch (loadError) {
      setError(loadError.message || 'Unable to load table names.');
    } finally {
      setLoadingTables(false);
    }
  }

  function chooseTable(value) {
    const next = value ? JSON.parse(value) : null;
    setSelectedTable(next);
    setPage(0);
    setTableData(null);
    setError('');
    setNotice('');
  }

  async function downloadCsv() {
    if (!selectedTable) {
      setActiveView('tables');
      setNotice('Select a table first, then choose Download CSV.');
      if (!tablesLoaded) await openTables();
      return;
    }

    setDownloading(true);
    setError('');
    setNotice('');
    const query = new URLSearchParams({ tableName: selectedTable.displayName || `${selectedTable.schema}.${selectedTable.name}` });
    try {
      const response = await fetch(apiUrl(`/api/table-data/csv?${query.toString()}`));
      if (!response.ok) throw new Error(await readError(response));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = selectedTable.name.replace(/[^a-z0-9_-]/gi, '_') + '.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`CSV download started for ${selectedTable.name}.`);
    } catch (downloadError) {
      setError(downloadError.message || 'CSV download failed.');
    } finally {
      setDownloading(false);
    }
  }

  const totalPages = tableData ? Math.max(1, Math.ceil(tableData.totalCount / PAGE_SIZE)) : 1;
  const firstRow = tableData && tableData.totalCount > 0 ? page * PAGE_SIZE + 1 : 0;
  const lastRow = tableData ? Math.min((page + 1) * PAGE_SIZE, tableData.totalCount) : 0;
  const visibleRows = tableData ? tableData.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : [];

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand-mark"><Icon name="database" size={22} /></div>
        <div className="brand-copy">
          <div className="brand-name">Data Viewer</div>
          <div className="brand-subtitle">PostgreSQL workspace</div>
        </div>
        <div className={`connection-status status-${health}`}>
          <span className="status-dot" />
          {health === 'checking' ? 'Checking connection' : health === 'connected' ? 'API reachable' : 'API offline'}
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="Main navigation">
          <div className="sidebar-label">WORKSPACE</div>
          <button className={`nav-item ${activeView === 'tables' ? 'active' : ''}`} onClick={openTables}>
            <Icon name="table" />
            <span>Tables</span>
            <span className="nav-chevron">›</span>
          </button>
          <button className="nav-item" onClick={downloadCsv} disabled={downloading}>
            <Icon name="download" />
            <span>{downloading ? 'Preparing CSV…' : 'Download CSV'}</span>
          </button>
          <div className="sidebar-divider" />
          <button className="nav-item muted-nav" onClick={() => { setSelectedTable(null); setPage(0); setTableData(null); setError(''); setNotice('View reset. Choose a table from the dropdown.'); setActiveView('tables'); }}>
            <Icon name="refresh" />
            <span>Reset view</span>
          </button>
          <div className="sidebar-spacer" />
          <div className="sidebar-footer">
            <div className="footer-icon"><Icon name="database" size={16} /></div>
            <div><strong>Read-only explorer</strong><span>Browse and export data</span></div>
          </div>
        </aside>

        <main className="content-shell">
          <section className="content-panel">
            {activeView === 'home' ? (
              <div className="welcome-state">
                <div className="welcome-icon"><Icon name="database" size={30} /></div>
                <p className="eyebrow">POSTGRESQL DATA TOOLS</p>
                <h1>Explore your data.</h1>
                <p className="welcome-description">Choose a table to preview its rows, inspect columns, and export the complete table to CSV.</p>
                <button className="primary-button" onClick={openTables}><Icon name="table" size={17} /> Open tables</button>
                {health === 'offline' && <p className="welcome-hint">The API could not be reached. Start the C# backend, then refresh this page.</p>}
              </div>
            ) : (
              <div className="table-view">
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">DATA WORKSPACE</p>
                    <h1>Table explorer</h1>
                    <p className="page-description">Select a PostgreSQL table to view its data.</p>
                  </div>
                  <button className="secondary-button" onClick={() => openTables(true)} disabled={loadingTables}>
                    <Icon name="refresh" size={16} /> Refresh tables
                  </button>
                </div>

                <div className="table-toolbar">
                  <label className="field-label" htmlFor="table-picker">Table name</label>
                  <div className="select-wrap">
                    <Icon name="table" size={17} />
                    <select id="table-picker" value={selectedTable ? JSON.stringify(selectedTable) : ''} onChange={(event) => chooseTable(event.target.value)} disabled={loadingTables || tables.length === 0}>
                      <option value="">{loadingTables ? 'Loading tables…' : tables.length ? 'Choose a table' : 'No tables available'}</option>
                      {tables.map((item) => <option key={`${item.schema}.${item.name}`} value={JSON.stringify(item)}>{item.displayName || `${item.schema}.${item.name}`}</option>)}
                    </select>
                    <Icon name="chevron" size={17} />
                  </div>
                  {selectedTable && <div className="selection-caption"><span className="tiny-green-dot" /> Selected: <strong>{selectedTable.schema}.{selectedTable.name}</strong></div>}
                </div>

                {error && <div className="notice error-notice" role="alert">{error}</div>}
                {notice && <div className="notice info-notice" role="status">{notice}</div>}

                <div className="data-card">
                  <div className="data-card-header">
                    <div>
                      <h2>{selectedTable ? selectedTable.name : 'Table data'}</h2>
                      <p>{tableData ? `${tableData.columns.length} columns · ${tableData.totalCount.toLocaleString()} rows` : 'Your selected table will appear here.'}</p>
                    </div>
                    {selectedTable && <button className="export-button" onClick={downloadCsv} disabled={downloading}><Icon name="download" size={16} /> {downloading ? 'Exporting…' : 'Export CSV'}</button>}
                  </div>

                  {!selectedTable && !loadingTables && (
                    <div className="empty-state">
                      <div className="empty-icon"><Icon name="search" size={24} /></div>
                      <strong>No table selected</strong>
                      <span>Use the dropdown above to choose the data you want to inspect.</span>
                    </div>
                  )}

                  {loadingData && <div className="loading-state"><span className="spinner" /> Loading table rows…</div>}

                  {!loadingData && tableData && (
                    <>
                      {tableData.rows.length === 0 ? (
                        <div className="empty-state compact-empty"><strong>This table is empty</strong><span>The table exists, but it does not contain any rows.</span></div>
                      ) : (
                        <div className="table-scroll">
                          <table>
                            <thead><tr>{tableData.columns.map((column) => <th key={column} title={column}>{column}</th>)}</tr></thead>
                            <tbody>
                              {visibleRows.map((row, rowIndex) => (
                                <tr key={`${page}-${rowIndex}`}>
                                  {tableData.columns.map((column) => <td key={column} title={formatCell(row[column])}>{formatCell(row[column])}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div className="table-footer">
                        <span>{tableData.totalCount === 0 ? '0 rows' : `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${tableData.totalCount.toLocaleString()} rows`}</span>
                        <div className="pagination">
                          <button onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>Previous</button>
                          <span>Page {page + 1} of {totalPages}</span>
                          <button onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={page + 1 >= totalPages}>Next</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <p className="page-footnote">Rows are paginated for display. Export CSV downloads the entire selected table.</p>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
