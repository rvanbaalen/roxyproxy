interface FilterBarProps {
  status: string;
  method: string;
  search: string;
  onStatusChange: (v: string) => void;
  onMethodChange: (v: string) => void;
  onSearchChange: (v: string) => void;
  onClearFilters: () => void;
  matchCount: number;
  totalCount: number;
}

export function FilterBar({
  status, method, search,
  onStatusChange, onMethodChange, onSearchChange, onClearFilters,
  matchCount, totalCount,
}: FilterBarProps) {
  const hasFilters = !!(status || method || search);

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 md:p-3 bg-gray-900 border-b border-gray-800">
      <input type="text" placeholder="Status" value={status} onChange={(e) => onStatusChange(e.target.value)}
        className="bg-gray-800 text-gray-100 px-2 py-1 rounded text-sm border border-gray-700 w-16 md:w-20 focus:border-blue-500 focus:outline-none" />
      <select value={method} onChange={(e) => onMethodChange(e.target.value)}
        className="bg-gray-800 text-gray-100 px-2 py-1 rounded text-sm border border-gray-700 focus:border-blue-500 focus:outline-none">
        <option value="">All Methods</option>
        <option value="GET">GET</option>
        <option value="POST">POST</option>
        <option value="PUT">PUT</option>
        <option value="PATCH">PATCH</option>
        <option value="DELETE">DELETE</option>
        <option value="OPTIONS">OPTIONS</option>
      </select>
      <input type="text" placeholder="Search URL..." value={search} onChange={(e) => onSearchChange(e.target.value)}
        className="bg-gray-800 text-gray-100 px-2 py-1 rounded text-sm border border-gray-700 flex-1 min-w-[8rem] focus:border-blue-500 focus:outline-none" />
      {hasFilters && (
        <>
          <span className="text-xs text-gray-500">{matchCount}/{totalCount}</span>
          <button onClick={onClearFilters} className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded text-sm">Clear</button>
        </>
      )}
    </div>
  );
}
