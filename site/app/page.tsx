import Link from "next/link";

const repositoryUrl = "https://github.com/x424protocol/x424";

export default function Home() {
  return (
    <main>
      <nav aria-label="Primary navigation">
        <Link className="wordmark" href="/" aria-label="x424 home">
          x424
        </Link>
        <a href={repositoryUrl}>GitHub ↗</a>
      </nav>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Human Dependency Protocol · pre-alpha</p>
        <h1 id="page-title">Make an HTTP action depend on one human.</h1>
        <p className="lede">
          x424 is an open, provider-neutral protocol for unique-human
          requirements across users, agents, wallets, and APIs.
        </p>
        <div className="actions">
          <a className="primary" href={repositoryUrl}>
            Read the specification ↗
          </a>
          <a href={`${repositoryUrl}/blob/main/openapi/x424.openapi.json`}>
            OpenAPI
          </a>
        </div>
      </section>

      <section className="wire" aria-labelledby="wire-title">
        <div className="section-heading">
          <p>Wire flow</p>
          <span>HTTP-native</span>
        </div>
        <h2 id="wire-title" className="sr-only">
          x424 wire flow
        </h2>
        <ol>
          <li>
            <code>01</code>
            <span>
              Server returns <strong>424 Failed Dependency</strong> with a
              <code> HUMAN-REQUIRED</code> challenge.
            </span>
          </li>
          <li>
            <code>02</code>
            <span>
              A human completes an explicitly accepted verification method.
            </span>
          </li>
          <li>
            <code>03</code>
            <span>
              The verifier issues a short-lived result bound to the exact
              request and caller.
            </span>
          </li>
          <li>
            <code>04</code>
            <span>
              The client retries with a signed <code>HUMAN-PROOF</code> token.
            </span>
          </li>
        </ol>
      </section>

      <section className="composition" aria-labelledby="composition-title">
        <div className="section-heading">
          <p>Composition</p>
          <span>Independent dependencies</span>
        </div>
        <h2 id="composition-title">
          Human first. Payment next. Application decides.
        </h2>
        <p>
          <code>x424 → x402 → authorization → execution</code>
        </p>
      </section>

      <footer>
        <span>Apache-2.0</span>
        <span>HTTP-native unique-human dependencies.</span>
      </footer>
    </main>
  );
}
