export const product = {
  name: 'Mane',
  tagline: 'Stays inside your network.',
  modules: {
    chat: {
      name: 'Mane-Chat',
      blurb: 'A private social layer for your organisation.',
      description:
        'Spaces, posts, comments, reactions, direct messages and media. Keep your conversations close.',
    },
    doc: {
      name: 'Mane-Doc',
      blurb: 'Meeting minutes generated on your own hardware.',
      description:
        'Turn meetings into structured minutes with attendees, decisions and action items. Powered by local AI.',
    },
  },
  pricing: [{ band: 'starter', seats: 100, license_usd: 5000, annual_usd: 2500 }],
  tiers: {
    pilot: { label: 'Pilot (CPU-only)', min_cores: 8, min_ram_gb: 32, gpu: false },
    production: { label: 'Production (1× GPU)', min_cores: 16, min_ram_gb: 64, gpu: true, min_vram_gb: 24 },
  },
  flags: { 'doc.languages': { supported: ['en'], beta: ['hi'] }, 'chat.dms': true, 'doc.diarization': false },
} as const;
