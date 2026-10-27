const navigationByRole = {
  patient: [
    ["home", "Request help", "+"],
    ["activity", "My requests", "▤"],
    ["profile", "Profile", "○"],
  ],
  dispatcher: [
    ["home", "Dispatch queue", "⌖"],
    ["activity", "Dispatch log", "▤"],
    ["profile", "Profile", "○"],
  ],
  ambulance: [
    ["home", "My shift", "◉"],
    ["activity", "Trip history", "▤"],
    ["profile", "Driver profile", "○"],
  ],
  admin: [
    ["home", "Overview", "⌂"],
    ["activity", "Trip monitor", "▤"],
    ["profile", "Account", "○"],
  ],
};

export default function WorkspaceNavigation({
  activeTab,
  onSelect,
  label = "Workspace navigation",
  variant = "patient",
}) {
  const items = navigationByRole[variant] || navigationByRole.patient;
  return (
    <nav className={`patient-bottom-nav workspace-nav-${variant}`} aria-label={label}>
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
