import { Link } from 'react-router-dom';

export default function LoginPage() {
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
        <span className="eyebrow">Welcome back</span>
        <h1>Sign in to EmergencyCare</h1>
        <p className="preview-auth-description">Sign in to continue to your EmergencyCare account.</p>
        <form className="preview-form" onSubmit={(event) => event.preventDefault()}>
          <label>
            Email address
            <input type="email" name="email" placeholder="you@example.com" autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" name="password" placeholder="Enter your password" autoComplete="current-password" required />
          </label>
          <button className="home-button home-button-dark preview-submit" type="submit">Sign in</button>
        </form>
        <p className="preview-auth-switch">New to EmergencyCare? <Link to="/register">Create an account</Link></p>
      </section>
    </main>
  );
}
