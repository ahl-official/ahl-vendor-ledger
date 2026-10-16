export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading-row">
      <span className="spinner" />
      {label}…
    </div>
  );
}
