import Link from "next/link";

const repositoryUrl = "https://github.com/x424protocol/x424";

export default function Home() {
  return (
    <main>
      <nav aria-label="Primary navigation">
        <Link className="wordmark" href="/" aria-label="x424 home">
          x424
        </Link>
        <div className="nav-links">
          <a href={`${repositoryUrl}/blob/main/docs/QUICKSTART.md`}>
            Quickstart
          </a>
          <a href={`${repositoryUrl}/blob/main/docs/STATUS.md`}>Status</a>
          <a href={repositoryUrl}>GitHub ↗</a>
        </div>
      </nav>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">
          Human Dependency Protocol · x424/0.1 developer preview · unaudited
        </p>
        <h1 id="page-title">
          x424 makes unique humanity a native HTTP dependency—for users, agents,
          and APIs.
        </h1>
        <p className="lede">
          Require one accepted unique human before an HTTP action executes—
          without rebuilding proof parsing, request binding, replay protection,
          or retry logic.
        </p>
        <div className="actions">
          <a
            className="primary"
            href={`${repositoryUrl}/blob/main/docs/QUICKSTART.md`}
          >
            Run the quickstart ↗
          </a>
          <a href={`${repositoryUrl}/blob/main/docs/PROTOCOL.md`}>Protocol</a>
          <a href={`${repositoryUrl}/blob/main/openapi/x424.openapi.json`}>
            OpenAPI
          </a>
        </div>
      </section>

      <section className="decision" aria-labelledby="decision-title">
        <div className="section-heading">
          <p>When to use x424</p>
          <span>One clear boundary</span>
        </div>
        <h2 id="decision-title">
          Use World directly for login. Use x424 when unique humanity is an HTTP
          precondition.
        </h2>
        <div className="decision-grid">
          <article>
            <p>Login or enrollment</p>
            <strong>Use the provider directly.</strong>
          </article>
          <article>
            <p>Human-gated HTTP action</p>
            <strong>Use x424.</strong>
          </article>
          <article>
            <p>Humanity before payment</p>
            <strong>Compose x424 before x402.</strong>
          </article>
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

      <section className="boundary" aria-labelledby="boundary-title">
        <div className="section-heading">
          <p>Responsibility boundary</p>
          <span>No universal identity authority</span>
        </div>
        <h2 id="boundary-title">Each layer has one job.</h2>
        <div className="boundary-grid">
          <article>
            <code>Provider</code>
            <h3>Proves uniqueness</h3>
            <p>
              World is the first maintained profile. Every provider keeps its
              exact claim and scope.
            </p>
          </article>
          <article>
            <code>x424</code>
            <h3>Enforces the dependency</h3>
            <p>
              Challenge, binding, verification, replay controls, signed result,
              and retry.
            </p>
          </article>
          <article>
            <code>Application</code>
            <h3>Authorizes the action</h3>
            <p>
              Accounts, permissions, business policy, and idempotent execution
              stay local.
            </p>
          </article>
        </div>
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

      <section className="quickstart" aria-labelledby="quickstart-title">
        <div className="section-heading">
          <p>Local evaluation</p>
          <span>One command after install</span>
        </div>
        <div>
          <h2 id="quickstart-title">See the complete dependency flow.</h2>
          <p>
            The automated source quickstart runs a synthetic 424 challenge,
            provider proof, signed result, exact retry, and 201 response. CI
            executes the same flow on every pull request.
          </p>
        </div>
        <pre aria-label="Quickstart command">
          <code>pnpm quickstart</code>
        </pre>
      </section>

      <section className="status" aria-labelledby="status-title">
        <div className="section-heading">
          <p>Release status</p>
          <span>Evidence before claims</span>
        </div>
        <h2 id="status-title">
          Built for evaluation. Not yet production-certified.
        </h2>
        <div className="status-grid">
          <div>
            <strong>Implemented and tested</strong>
            <p>
              TypeScript SDK, World profile, framework adapters, durable stores,
              verifier image, and x402 composition.
            </p>
          </div>
          <div>
            <strong>Still required</strong>
            <p>
              Independent audit, real World staging matrix, managed service,
              operational evidence, and independent interoperability.
            </p>
          </div>
        </div>
        <a
          className="text-link"
          href={`${repositoryUrl}/blob/main/docs/STATUS.md`}
        >
          Read the public evidence matrix ↗
        </a>
      </section>

      <footer>
        <span>Apache-2.0 · x424/0.1 developer preview</span>
        <span>Providers prove. x424 enforces. Applications authorize.</span>
      </footer>
    </main>
  );
}
