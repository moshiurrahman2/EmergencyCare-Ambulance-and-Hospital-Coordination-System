import { Link } from 'react-router-dom';

export default function RegisterPage() {
  return (
    <main className="preview-auth">
      <header className="preview-auth-header">
        <Link className="home-brand" to="/" aria-label="EmergencyCare home">
          <span className="brand-mark" aria-hidden="true">+</span>
          <span>Emergency<span className="brand-light">Care</span></span>
        </Link>
        <Link className="preview-back-link" to="/">Back to home</Link>
      </header>
      <section className="preview-auth-card">
        <span className="eyebrow">Get started</span>
        <h1>Create your account</h1>
        <p className="preview-auth-description">Create an EmergencyCare account to get started.</p>
        <form className="preview-form" onSubmit={(event) => event.preventDefault()}>
          <label>
            Full name
            <input type="text" name="name" placeholder="Your name" autoComplete="name" required />
          </label>
          <label>
            Phone number
            <input type="tel" name="phone" placeholder="Your phone number" autoComplete="tel" required />
          </label>
          <label>
            Email address
            <input type="email" name="email" placeholder="you@example.com" autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" name="password" placeholder="Create a password" autoComplete="new-password" required />
          </label>
          <label>
            I am joining as
            <select name="role" defaultValue="patient">
              <option value="patient">Patient</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="ambulance">Ambulance team</option>
            </select>
          </label>
          <button className="home-button home-button-dark preview-submit" type="submit">Create account</button>
        </form>
        <p className="preview-auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
      </section>
    </main>
  );
}
