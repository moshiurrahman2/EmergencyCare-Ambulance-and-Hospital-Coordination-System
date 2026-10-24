const items = [
  ["home", "Home", "⌂"],
  ["activity", "Activity", "▤"],
  ["profile", "Profile", "○"],
];

export default function WorkspaceNavigation({ activeTab, onSelect, label = "Workspace navigation" }) {
  return (
    <nav className="patient-bottom-nav" aria-label={label}>
      {items.map(([value, title, icon]) => (
        <button
          key={value}
          className={`patient-nav-tab ${activeTab === value ? "selected" : ""}`}
          aria-current={activeTab === value ? "page" : undefined}
          onClick={() => onSelect(value)}
        >
          <span aria-hidden="true">{icon}</span>
          {title}
        </button>
      ))}
    </nav>
  );
}
