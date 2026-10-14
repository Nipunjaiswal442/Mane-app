import { ArrowUpRight } from 'lucide-react';
import { product } from '@mane/product-config';
export default function Docs() {
  return (
    <main id="main" className="doc-page">
      <header className="site-header">
        <a href="/" className="wordmark">
          Mane<span>®</span>
        </a>
        <a className="button" href="/app" style={{ marginLeft: 'auto' }}>
          Open workspace <ArrowUpRight size={16} />
        </a>
      </header>
      <h1>
        YOUR WORKSPACE.
        <br />
        YOUR INFRASTRUCTURE.
      </h1>
      <p>
        Mane brings private team conversations and locally generated meeting minutes onto one appliance. This
        guide covers the development setup; the repository includes the complete appliance and operations
        guides.
      </p>
      <section id="setup">
        <h2>01 / GET RUNNING</h2>
        <p>
          Install Node 22+, pnpm 9+, Python 3.12, uv, ffmpeg, Ollama, and OrbStack or Docker Desktop. Start
          your container runtime, then clone the repository:
        </p>
        <pre>
          {
            'git clone https://github.com/Nipunjaiswal442/Mane-app.git\ncd Mane-app\ncp .env.example .env\nmake setup\nollama pull qwen2.5:3b-instruct\n# Download Whisper weights once; set STT_MODEL_PATH in .env\nmake doctor\nmake dev'
          }
        </pre>
        <p>
          Open localhost:3000. Select Get started to create your organisation and first administrator. Add
          members in Settings. The development services bind to the local machine.
        </p>
        <p>
          <a href="/app?demo=1">Explore the interactive demo</a> to see the interface before configuring the
          backend. Demo changes stay in your browser and demo meetings are explicitly illustrative.
        </p>
      </section>
      <section>
        <h2>02 / A CONVERSATION BECOMES KNOWLEDGE</h2>
        <ul>
          <li>Create a space and invite the people who belong there.</li>
          <li>Share posts, add comments and reactions, or start a direct message.</li>
          <li>Upload a recording in Mane-Doc. Select the destination space and reviewer.</li>
          <li>Review the draft, check timestamped evidence, and correct any uncertain details.</li>
          <li>Approve the minutes to render documents and publish them back to the space.</li>
        </ul>
      </section>
      <section id="privacy">
        <h2>03 / LOCAL BY DESIGN</h2>
        <p>
          Models and dependencies are downloaded during setup. Runtime inference uses local Ollama on Apple
          Silicon, or an appliance-local vLLM endpoint with NVIDIA acceleration. The application includes no
          third-party fonts, analytics, or cloud AI calls.
        </p>
        <p>
          Private spaces and direct messages are checked on the server. The appliance administrator controls
          membership, storage quotas, retention and licensing. Use the production installation guide to
          configure TLS and the appliance network boundary.
        </p>
      </section>
      <section id="licensing">
        <h2>04 / LICENSING</h2>
        {product.pricing.map((p) => (
          <p key={p.band}>
            {p.seats} seats: ${p.license_usd.toLocaleString('en-US')} one-time license, plus $
            {p.annual_usd.toLocaleString('en-US')} per year for maintenance and updates. License purchase is
            handled outside the application.
          </p>
        ))}
        <p>
          A missing license starts a 14-day evaluation. Maintenance expiry affects update eligibility; it does
          not disable sign-in. Administrators can upload a signed license in Settings.
        </p>
      </section>
      <section>
        <h2>05 / OPERATIONS</h2>
        <p>
          The repository includes backup and restore scripts, a production Compose reference, a signed offline
          update verifier and a hardware preflight. Before production rollout, run the documented acceptance
          suite on the intended appliance and record model quality and timing on representative recordings.
        </p>
        <a href="https://github.com/Nipunjaiswal442/Mane-app/tree/main/docs">
          Read the appliance guides on GitHub ↗
        </a>
      </section>
    </main>
  );
}
