import React from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  MoveUpRight,
  MessagesSquare,
  FileText,
  ShieldCheck,
  Server,
  Check,
  Cpu,
} from 'lucide-react';
import { product } from '@mane/product-config';

export function Landing() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Mane home">
          {product.name}
          <span>®</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#product">Product</a>
          <a href="#security">Security</a>
          <a href="#deploy">Deploy</a>
          <a href="/docs">
            Docs <ArrowUpRight size={12} />
          </a>
        </nav>
        <a href="/app" className="button black header-cta">
          Get started <ArrowUpRight size={16} />
        </a>
      </header>
      <main id="main">
        <div className="edition-bar">
          <span>
            <i className="status-dot" /> Independent by design.
          </span>
          <span>COLLABORATION / WITHOUT COMPROMISE</span>
          <span>EST. 2026</span>
        </div>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-main">
            <p className="eyebrow">YOUR PEOPLE. YOUR KNOWLEDGE. YOUR NETWORK.</p>
            <h1 id="hero-title">
              SAME PEOPLE.
              <br />
              DEEPER WORK.
            </h1>
            <div className="hero-bottom">
              <a href="/app" className="button black large">
                Get started <ArrowRight size={21} />
              </a>
              <a href="/app?demo=1" className="button large">
                Explore the demo <MoveUpRight size={20} />
              </a>
              <span className="hero-index">01 — STAY TOGETHER</span>
            </div>
          </div>
          <aside className="hero-aside">
            <p className="hero-intro">
              PRIVATE
              <br />
              COLLABORATION
              <br />
              AND AI-POWERED
              <br />
              MEETING MINUTES
              <br />
              FOR YOUR
              <br />
              ORGANISATION.
            </p>
            <div className="concrete-image">
              <img
                src="/architecture.svg"
                alt="Monumental concrete architecture with sharp geometric shadows"
              />
              <span className="image-caption">SPACE TO DO GOOD WORK.</span>
            </div>
            <div className="hero-note">
              <p>
                SELF-HOSTED.
                <br />
                NO CLOUD.
                <br />
                YOUR RULES.
              </p>
              <ArrowDownShape />
            </div>
          </aside>
        </section>
        <section id="product" className="modules" aria-label="Two modules, one private workspace">
          {Object.entries(product.modules).map(([key, module], i) => (
            <a key={key} href={`/app?demo=1&view=${key === 'doc' ? 'meetings' : 'feed'}`} className="module">
              <div className="module-top">
                <span className="eyebrow">
                  0{i + 1} / {key === 'doc' ? 'KNOWLEDGE, KEPT.' : 'CONVERSATIONS, CONNECTED.'}
                </span>
                <ArrowUpRight size={31} />
              </div>
              <div className="module-title">
                {key === 'chat' ? (
                  <MessagesSquare size={30} strokeWidth={1.5} />
                ) : (
                  <FileText size={30} strokeWidth={1.5} />
                )}
                <h2>{module.name}</h2>
              </div>
              <p>{module.description}</p>
              <span className="text-link">
                Explore {module.name} <ArrowRight size={17} />
              </span>
            </a>
          ))}
        </section>
        <section className="manifesto" id="security">
          <img src="/corridor.svg" alt="A light-filled opening in a dark concrete passage" />
          <div className="manifesto-copy">
            <span className="eyebrow">02 / BUILT FOR CONTROL</span>
            <h2>
              BUILT FOR
              <br />
              ORGANISATIONS
              <br />
              THAT KEEP
              <br />
              CONTROL.
            </h2>
          </div>
          <div className="manifesto-note">
            <ShieldCheck size={32} strokeWidth={1.3} />
            <p>
              YOUR DATA.
              <br />
              YOUR INFRASTRUCTURE.
              <br />
              YOUR PEOPLE.
            </p>
            <p>A MORE FOCUSED TOMORROW.</p>
          </div>
        </section>
        <section className="principles">
          <div>
            <span className="eyebrow">THE BOUNDARY IS YOUR NETWORK.</span>
            <h2>
              What happens here,
              <br />
              stays here.
            </h2>
          </div>
          <div className="principle-list">
            <article>
              <span>01</span>
              <div>
                <h3>Private by architecture.</h3>
                <p>
                  Messages, files and meeting recordings live on your hardware. No telemetry. No external AI
                  services.
                </p>
              </div>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>AI with a paper trail.</h3>
                <p>
                  Decisions and action items link back to the recording. Review the evidence. Edit the draft.
                  Then publish.
                </p>
              </div>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>One place to move work forward.</h3>
                <p>
                  From a conversation to a decision to a done action item. Your team’s knowledge stays
                  connected.
                </p>
              </div>
            </article>
          </div>
        </section>
        <section className="deploy" id="deploy">
          <div className="section-heading">
            <span className="eyebrow">03 / YOUR HARDWARE. YOUR TERMS.</span>
            <h2>
              A SMALL FOOTPRINT.
              <br />A FIRM FOUNDATION.
            </h2>
          </div>
          <div className="hardware-grid">
            {Object.entries(product.tiers).map(([key, tier]) => (
              <article className="hardware" key={key}>
                <div className="module-top">
                  <span className="eyebrow">{key.toUpperCase()}</span>
                  {tier.gpu ? <Server size={25} /> : <Cpu size={25} />}
                </div>
                <h3>{tier.label}</h3>
                <ul>
                  <li>{tier.min_cores}+ CPU cores</li>
                  <li>{tier.min_ram_gb} GB RAM</li>
                  <li>{'min_vram_gb' in tier ? `${tier.min_vram_gb} GB NVIDIA GPU` : 'No GPU required'}</li>
                </ul>
                <p>
                  {key === 'pilot'
                    ? 'A place to start. Local collaboration and on-device meeting intelligence.'
                    : 'Room to grow. CUDA-accelerated transcription and local model serving.'}
                </p>
              </article>
            ))}
          </div>
          <p className="hardware-note">
            Recommended appliance specifications. The Apple Silicon development profile also supports 16 GB
            unified memory.
          </p>
        </section>
        <section className="pricing" id="pricing">
          <div>
            <span className="eyebrow">04 / STRAIGHTFORWARD OWNERSHIP</span>
            <h2>
              BUY THE LICENSE.
              <br />
              KEEP THE CONTROL.
            </h2>
            <p>
              One appliance. Your entire organisation.
              <br />
              No per-message fees. No cloud dependency.
            </p>
          </div>
          {product.pricing.map((band) => (
            <article key={band.band} className="price-card">
              <div className="module-top">
                <h3>{band.band}</h3>
                <span className="eyebrow">UP TO {band.seats} PEOPLE</span>
              </div>
              <p className="price">
                ${band.license_usd.toLocaleString('en-US')}
                <span>USD / ONE-TIME LICENSE</span>
              </p>
              <p className="annual">
                + ${band.annual_usd.toLocaleString('en-US')} / year for maintenance & updates
              </p>
              <ul>
                <li>
                  <Check size={16} /> Mane-Chat & Mane-Doc
                </li>
                <li>
                  <Check size={16} /> Your infrastructure, your data
                </li>
                <li>
                  <Check size={16} /> Admin controls & offline updates
                </li>
              </ul>
              <a href="/docs#licensing" className="button black">
                Explore deployment <ArrowUpRight size={18} />
              </a>
            </article>
          ))}
        </section>
        <section className="closing">
          <span className="eyebrow">SAME PEOPLE. A MORE FOCUSED TOMORROW.</span>
          <a href="/app">
            <h2>LET’S GET TO WORK.</h2>
            <ArrowUpRight />
          </a>
        </section>
      </main>
      <footer className="site-footer">
        <a className="wordmark" href="/">
          {product.name}
          <span>®</span>
        </a>
        <span>SELF-HOSTED COLLABORATION.</span>
        <div>
          <a href="/docs">
            Documentation <ArrowUpRight size={12} />
          </a>
          <span>© 2026 MANE</span>
        </div>
      </footer>
    </div>
  );
}
function ArrowDownShape() {
  return (
    <svg viewBox="0 0 44 44" width="38" height="38" aria-hidden="true">
      <path d="M5 5h34v34M5 39 39 5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
