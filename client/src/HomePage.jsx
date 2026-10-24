import { Link } from "react-router-dom";

const features = [
  {
    number: "01",
    title: "Request emergency help",
    description:
      "Patients can submit symptoms and location details to start an emergency request.",
  },
  {
    number: "02",
    title: "Coordinate response",
    description:
      "Dispatchers and ambulance teams can review requests and coordinate the next steps.",
  },
  {
    number: "03",
    title: "Keep care connected",
    description:
      "Care teams can coordinate treatment details and follow-up through one system.",
  },
];

export default function HomePage() {
  return (
    <main className="home-page">
      <header className="home-header">
        <Link className="home-brand" to="/" aria-label="EmergencyCare home">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>
          <span>
            Emergency<span className="brand-light">Care</span>
          </span>
        </Link>
        <nav className="home-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#who-its-for">Who it&apos;s for</a>
        </nav>
        <div className="home-nav-actions">
          <Link className="home-login-link" to="/login">
            Sign in
          </Link>
          <Link
            className="home-button home-button-dark home-button-small"
            to="/signup"
          >
            Get started
          </Link>
        </div>
      </header>

      <section className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="eyebrow-dot" />
            Emergency response, connected
          </span>
          <h1>
            When every moment matters, <span>care moves together.</span>
          </h1>
          <p className="hero-description">
            EmergencyCare brings patients, dispatchers, and ambulance teams
            into one coordinated emergency response platform.
          </p>
          <div className="hero-actions">
            <Link className="home-button home-button-dark" to="/signup">
              Get started <span aria-hidden="true">→</span>
            </Link>
            <Link className="home-button home-button-outline" to="/login">
              Sign in to your account
            </Link>
          </div>
          <p className="hero-note">
            For emergencies, contact your local emergency services directly.
          </p>
        </div>

        <div
          className="hero-visual"
          aria-label="A connected emergency response team illustration"
        >
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="visual-center">
            <span className="visual-cross" aria-hidden="true">
              +
            </span>
            <strong>
              One connected
              <br />
              response
            </strong>
            <span>People · Care · Coordination</span>
          </div>
          <div className="visual-node node-patient">
            <span aria-hidden="true">P</span> Patient
          </div>
          <div className="visual-node node-dispatch">
            <span aria-hidden="true">D</span> Dispatcher
          </div>
          <div className="visual-node node-ambulance">
            <span aria-hidden="true">A</span> Ambulance
          </div>
          <span className="visual-spark spark-one" aria-hidden="true">
            ✳
          </span>
          <span className="visual-spark spark-two" aria-hidden="true">
            ✳
          </span>
        </div>
      </section>

      <section className="home-trust-strip" aria-label="Platform participants">
        <span>Built for the full response journey</span>
        <div>Patients</div>
        <div>Dispatchers</div>
        <div>Ambulance teams</div>
      </section>

      <section className="home-process" id="how-it-works">
        <div className="section-heading">
          <span className="eyebrow">A clearer path to care</span>
          <h2>One platform. Every step connected.</h2>
          <p>
            Bring the people involved in emergency response together with tools
            for each role.
          </p>
        </div>
        <div className="feature-grid">
          {features.map((feature) => (
            <article className="feature-card" key={feature.number}>
              <span className="feature-number">{feature.number}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <span className="feature-arrow" aria-hidden="true">
                ↗
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="home-cta" id="who-its-for">
        <div>
          <span className="eyebrow">Your role has a place here</span>
          <h2>Be part of a more connected response.</h2>
          <p>Create an account to access the tools for your role.</p>
        </div>
        <Link className="home-button home-button-light" to="/signup">
          Create your account <span aria-hidden="true">→</span>
        </Link>
      </section>

      <footer className="home-footer">
        <span>EmergencyCare</span>
        <p className="home-footer-contact">
          For queries:{" "}
          <a href="mailto:emergencycare@gmail.com">
            emergencycare@gmail.com
          </a>
          <br />
          Contact: <a href="tel:01781973128">01781973128</a>
        </p>
      </footer>
    </main>
  );
}
