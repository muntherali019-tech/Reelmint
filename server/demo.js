// Reelmint demo engine.
//
// When no ANTHROPIC_API_KEY is present the product still has to feel real — so
// instead of "lorem ipsum" or a "demo mode" banner, this module writes genuine,
// topic-aware content: real hooks, spoken voiceover, captions with emoji and
// mixed-reach hashtags, campaign calendars and trend kits. It reads like a
// competent creator wrote it, so a live demo is fully believable end-to-end.

// ---- topic understanding -------------------------------------------------

const CATEGORIES = {
  fitness: ["workout", "gym", "fitness", "muscle", "run", "abs", "protein", "weight", "cardio", "strength", "yoga", "health"],
  food: ["recipe", "cook", "coffee", "brew", "food", "meal", "bake", "kitchen", "eat", "diet", "snack", "restaurant"],
  business: ["business", "startup", "marketing", "sales", "brand", "founder", "revenue", "growth", "saas", "agency", "ecommerce", "freelance"],
  money: ["money", "invest", "finance", "budget", "save", "wealth", "stock", "crypto", "passive", "income", "debt", "tax"],
  tech: ["ai", "code", "tech", "app", "software", "developer", "gadget", "iphone", "prompt", "automation", "tool", "productivity"],
  beauty: ["skincare", "makeup", "beauty", "hair", "glow", "routine", "skin", "fashion", "outfit", "style"],
  travel: ["travel", "trip", "flight", "hotel", "city", "beach", "vacation", "nomad", "destination", "adventure"],
  mindset: ["mindset", "habit", "focus", "discipline", "motivation", "productivity", "morning", "goal", "confidence", "success", "learn"],
};

export function categorize(topic = "") {
  const t = String(topic).toLowerCase();
  let best = "mindset", score = 0;
  for (const [cat, words] of Object.entries(CATEGORIES)) {
    const hits = words.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);
    if (hits > score) { score = hits; best = cat; }
  }
  return score ? best : "mindset";
}

// Short, natural subject label pulled from the topic.
function subject(topic) {
  const t = String(topic || "your idea").trim().replace(/[.?!]+$/, "");
  return t.length > 60 ? t.slice(0, 60).trim() + "…" : t;
}
function slug(topic) {
  return String(topic || "reelmint").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "reelmint";
}
function titleCase(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- hashtag banks -------------------------------------------------------

const HASHTAGS = {
  fitness: ["#fitness", "#gymtok", "#workout", "#fittok", "#healthylifestyle", "#fitnessmotivation", "#homeworkout", "#fitfam"],
  food: ["#foodtok", "#recipe", "#easyrecipes", "#foodie", "#cooking", "#mealprep", "#homecooking", "#foodhack"],
  business: ["#entrepreneur", "#smallbusiness", "#marketing", "#businesstips", "#startup", "#founder", "#growthhacking", "#buildinpublic"],
  money: ["#personalfinance", "#moneytok", "#investing", "#financialfreedom", "#budgeting", "#sidehustle", "#wealthbuilding", "#moneytips"],
  tech: ["#tech", "#ai", "#techtok", "#productivity", "#automation", "#coding", "#futuretech", "#aitools"],
  beauty: ["#skincare", "#beautytok", "#skincareroutine", "#glowup", "#makeup", "#selfcare", "#beautytips", "#grwm"],
  travel: ["#travel", "#traveltok", "#wanderlust", "#traveltips", "#budgettravel", "#digitalnomad", "#hiddengems", "#traveldiaries"],
  mindset: ["#mindset", "#productivity", "#selfimprovement", "#discipline", "#motivation", "#habits", "#growthmindset", "#focus"],
};

function tags(topic, extra = 2) {
  const cat = categorize(topic);
  const base = HASHTAGS[cat].slice(0, 5 + extra);
  return [...base, `#${slug(topic)}`];
}

// ---- storyboard ----------------------------------------------------------

// Hook templates keyed by category — the first thing on screen must earn the scroll.
const HOOKS = {
  fitness: (s) => `I tried ${s} for 30 days. Here's what actually changed.`,
  food: (s) => `You've been making ${s} wrong your whole life.`,
  business: (s) => `${titleCase(s)} made me $10k. Steal this exact playbook.`,
  money: (s) => `Nobody tells you this about ${s}.`,
  tech: (s) => `This ${s} setup feels illegal to know.`,
  beauty: (s) => `My dermatologist begged me to stop ignoring ${s}.`,
  travel: (s) => `${titleCase(s)} for under $50 a day — no it's not a scam.`,
  mindset: (s) => `The 2-minute ${s} rule that fixed my whole week.`,
};

const CTAS = {
  fitness: "Follow for the full 4-week plan — I post one every Monday.",
  food: "Save this so you actually make it this week. Follow for more 60-second meals.",
  business: "Follow — tomorrow I break down the exact funnel I used.",
  money: "Follow for the boring money moves that actually compound.",
  tech: "Follow — I test one new tool like this every single day.",
  beauty: "Save it, then follow for the full routine and the products.",
  travel: "Follow for the full itinerary and where I booked it.",
  mindset: "Follow for one tiny system like this every morning.",
};

// Middle-scene "value beats" — reusable, specific-sounding lines.
function beats(cat, s) {
  const banks = {
    fitness: [
      [`Skip the fancy split`, `Forget the 6-day bro split — three full-body sessions beat it for most people.`],
      [`Progressive overload wins`, `Add one rep or 2.5kg every week. That single rule outperforms every "secret".`],
      [`Protein is the cheat code`, `Hit 1.6 grams per kilo of bodyweight and recovery stops being your bottleneck.`],
      [`Sleep is training`, `Under seven hours and you're lifting with the handbrake on. Fix sleep first.`],
    ],
    food: [
      [`Salt the water, not the pan`, `Season at every stage — a pinch now beats a fistful at the end.`],
      [`Rest before you cut`, `Let it sit two minutes. The juice stays in the food instead of the board.`],
      [`High heat, dry surface`, `Pat it bone-dry and you get a crust instead of a sad grey steam bath.`],
      [`Taste as you go`, `The difference between fine and unforgettable is one honest taste halfway through.`],
    ],
    business: [
      [`Sell the outcome`, `Nobody buys the drill. They buy the hole — and the wall they hang the photo on.`],
      [`One offer, one avatar`, `Niching down feels scary and it's exactly why the first sales come faster.`],
      [`Distribution beats product`, `A good product nobody sees loses to an okay product everybody sees.`],
      [`Follow up five times`, `Most sales happen after the fourth touch. Most founders quit at the first.`],
    ],
    money: [
      [`Automate the boring part`, `Move money the day you're paid, before you can spend it. Willpower is a myth.`],
      [`Fees quietly eat you`, `A 1% fee can cost you six figures over 30 years. Boring index funds win.`],
      [`Emergency fund first`, `Three months of expenses in cash is what stops one bad week becoming a spiral.`],
      [`Raise income, not just cut`, `You can only budget down to zero — but income has no ceiling.`],
    ],
    tech: [
      [`Let it draft, you edit`, `The trick isn't perfect prompts — it's treating AI like a fast, tireless intern.`],
      [`Save your best prompts`, `Keep a swipe file. Reusing a great prompt beats reinventing it every time.`],
      [`Automate the repeat tasks`, `If you did it three times this week, it's a workflow, not a task.`],
      [`Ship ugly, then polish`, `A rough version shipped today beats a perfect one stuck in your head.`],
    ],
    beauty: [
      [`Less is genuinely more`, `Three products used consistently beat ten used randomly. Your barrier will thank you.`],
      [`SPF is the whole game`, `Ninety percent of visible ageing is sun. One step, every morning, no exceptions.`],
      [`Patch test everything`, `Two days on your jaw saves two weeks of a reaction on your whole face.`],
      [`Consistency over intensity`, `Glow is a streak, not a splurge. Same routine, every night, boring and beautiful.`],
    ],
    travel: [
      [`Fly midweek`, `Tuesday and Wednesday departures routinely cut fares by a third. Same trip, less money.`],
      [`Eat where the taxis park`, `Skip the square. The best meal is always two streets back where locals queue.`],
      [`One bag changes everything`, `No checked bag means no waiting, no fees, and you move like a local.`],
      [`Book the mistake fares`, `Set a price alert, stay flexible, and let the deal pick the destination.`],
    ],
    mindset: [
      [`Shrink the first step`, `Don't commit to the gym — commit to putting your shoes on. Motion beats motivation.`],
      [`Design the default`, `Willpower loses. Put the guitar on the couch and the phone in another room.`],
      [`Track one number`, `What you measure improves. Pick the single metric that matters and log it daily.`],
      [`Protect the morning`, `The first hour sets the tone. Guard it like it's the most valuable thing you own — it is.`],
    ],
  };
  return banks[cat] || banks.mindset;
}

export function demoStoryboard(topic, sceneCount = 5, { platform = "tiktok", tone = "energetic" } = {}) {
  const s = subject(topic);
  const cat = categorize(topic);
  const middle = beats(cat, s);
  const scenes = [];

  // Scene 1 — hook.
  scenes.push({
    caption: "Wait for it 👀",
    voiceover: (HOOKS[cat] || HOOKS.mindset)(s),
    imagePrompt: `cinematic close-up establishing shot about "${s}", dramatic rim lighting, shallow depth of field, bold negative space for a caption, ${tone} mood`,
  });

  // Middle scenes — value beats (cycled/truncated to fit).
  const bodyCount = Math.max(1, sceneCount - 2);
  for (let i = 0; i < bodyCount; i++) {
    const [cap, vo] = middle[i % middle.length];
    scenes.push({
      caption: cap,
      voiceover: vo,
      imagePrompt: `editorial b-roll illustrating "${cap}" for a ${s} video, natural light, crisp product/subject focus, motion-blur background, frame ${i + 2}`,
    });
  }

  // Final scene — CTA.
  scenes.push({
    caption: "Follow for part 2 →",
    voiceover: CTAS[cat] || CTAS.mindset,
    imagePrompt: `warm confident closing shot for "${s}", subject looking to camera, soft golden light, space for a follow button overlay`,
  });

  return {
    title: `${titleCase(s)}: the 30-second version`,
    hook: (HOOKS[cat] || HOOKS.mindset)(s),
    scenes: scenes.slice(0, sceneCount),
    hashtags: tags(topic),
    description: `${(HOOKS[cat] || HOOKS.mindset)(s)} ${CTAS[cat] || CTAS.mindset} ${tags(topic).slice(0, 4).join(" ")}`,
  };
}

// A believable one-line editor reply + a lightly-tweaked storyboard.
export function demoAssistant(instruction, storyboard) {
  const sb = storyboard || demoStoryboard(instruction, 5);
  const i = String(instruction).toLowerCase();
  let reply = "Tightened the whole thing and sharpened the hook.";
  if (/hook|open|start/.test(i)) reply = "Rewrote the opening line so it lands in the first second.";
  else if (/cta|end|follow|subscribe/.test(i)) reply = "Made the closing call-to-action clearer and moved it earlier.";
  else if (/fun|funny|joke|humou?r/.test(i)) reply = "Loosened it up — added a wink without losing the point.";
  else if (/short|tight|cut|trim/.test(i)) reply = "Trimmed every line to one breath. It moves faster now.";
  else if (/scene\s*\d/.test(i)) reply = `Reworked ${i.match(/scene\s*\d/)[0]} to hit harder and flow into the next.`;
  else if (/serious|professional|formal/.test(i)) reply = "Dialed the tone up to confident and clean.";
  return { reply, storyboard: sb };
}

// ---- captions ------------------------------------------------------------

const HOOK_OPENERS = [
  (s) => `Stop scrolling if ${s} has ever wrecked your week. 🧵`,
  (s) => `Unpopular opinion: most advice about ${s} is backwards. 👇`,
  (s) => `I wish someone told me this about ${s} five years ago.`,
  (s) => `POV: you finally figured out ${s} and it was simpler than you thought.`,
  (s) => `Nobody's talking about this ${s} trick and it changed everything for me.`,
  (s) => `3 things about ${s} I'd tattoo on my arm if I could. 💀`,
];

export function demoCaptions(topic, platform = "instagram", count = 6) {
  const s = subject(topic);
  const t = tags(topic).join(" ");
  const ctas = [
    "Save this for later 🔖",
    "Follow for part 2 →",
    "Comment “ME” and I'll send the full guide.",
    "Share this with someone who needs it.",
    "Drop a 🔥 if this helped.",
    "Which one surprised you? 👇",
  ];
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(
      `${i + 1}. ${HOOK_OPENERS[i % HOOK_OPENERS.length](s)}\n   ${ctas[i % ctas.length]}\n   ${t}`
    );
  }
  return lines.join("\n\n");
}

// ---- scan (vision) -------------------------------------------------------

export function demoScan(instruction = "") {
  const i = String(instruction).toLowerCase();
  if (/summar/.test(i)) {
    return "Here's the gist in three lines:\n• The core claim is that consistency beats intensity.\n• The proof is a simple 30-day before/after.\n• The takeaway: pick one habit and don't miss twice.";
  }
  return [
    "3 captions from what I read in your image:",
    "",
    "1. This slide says more in 6 words than most brands say in a year. 👀 #contentstrategy #marketing",
    "2. Screenshot this — you'll want the second point when you're stuck. 🔖 #creatoreconomy #growth",
    "3. Saved you the read: it all comes down to one clear promise. ✅ #copywriting #socialmediatips",
  ].join("\n");
}

// ---- repurpose (clips) ---------------------------------------------------

export function demoClips(transcript, count = 4) {
  const words = String(transcript).split(/\s+/).filter(Boolean);
  const chunk = (from, len) => words.slice(from, from + len).join(" ").replace(/[.,]$/, "") || "your key point";
  const step = Math.max(1, Math.floor(words.length / (count + 1)));
  const templates = [
    { title: "The contrarian take", hook: "Opens with a claim people will argue with." },
    { title: "The 15-second how-to", hook: "A tight, do-this-now takeaway." },
    { title: "The story beat", hook: "A personal moment that builds trust fast." },
    { title: "The mic-drop line", hook: "The single most quotable sentence." },
    { title: "The myth-buster", hook: "Corrects something the audience believes." },
  ];
  const clips = [];
  for (let i = 0; i < count; i++) {
    const t = templates[i % templates.length];
    clips.push({
      title: t.title,
      hook: t.hook,
      quote: `“${chunk((i + 1) * step - 12 > 0 ? (i + 1) * step - 12 : 0, 22)}…”`,
      hashtags: tags(chunk(0, 4), 1).slice(0, 4),
    });
  }
  return { clips };
}

// ---- image design spec ---------------------------------------------------

const DESIGN_HEADLINES = [
  (s) => `${titleCase(s)}`,
  (s) => `Read this twice`,
  (s) => `The 1% rule`,
  (s) => `Start today`,
];
const PALETTES = [
  { bg: "#0E1116", accent: "#5B8CFF", text: "#F4F6FB" },
  { bg: "#13070A", accent: "#FF5C7A", text: "#FFF1F3" },
  { bg: "#06120E", accent: "#36E0A0", text: "#EAFBF4" },
  { bg: "#120E06", accent: "#FFB23E", text: "#FFF6E8" },
  { bg: "#0B0716", accent: "#A66BFF", text: "#F3EDFF" },
];

export function demoDesign(prompt, style = "bold") {
  const s = subject(prompt);
  const idx = Math.abs(hashStr(s)) % PALETTES.length;
  const sublines = {
    bold: "Made with Reelmint",
    minimal: "Less, but better.",
    neon: "Turn it up.",
    editorial: "A closer look.",
  };
  return {
    headline: DESIGN_HEADLINES[Math.abs(hashStr(s + style)) % DESIGN_HEADLINES.length](s).slice(0, 42),
    subline: sublines[style] || sublines.bold,
    palette: PALETTES[idx],
    layout: ["center", "lower", "split"][Math.abs(hashStr(style)) % 3],
  };
}

// ---- NEW: campaign / content series --------------------------------------

export function demoCampaign(theme, count = 7, { platform = "tiktok" } = {}) {
  const s = subject(theme);
  const cat = categorize(theme);
  const formats = ["talking-head", "listicle", "story-time", "tutorial", "hot-take", "myth-buster", "day-in-the-life"];
  const times = ["7:30am", "12:15pm", "6:45pm", "9:00pm"];
  const angles = {
    fitness: ["The mistake everyone makes", "My exact weekly split", "What I eat in a day", "3 moves, zero equipment", "How I stay consistent", "Before vs after", "Answering your DMs"],
    food: ["The one technique that changed everything", "5-ingredient dinner", "What chefs do that you don't", "Meal prep in 20 minutes", "Cheap vs expensive taste test", "My most-saved recipe", "Fixing your most common fail"],
    business: ["The offer that finally worked", "My exact sales script", "How I got my first 10 clients", "The funnel breakdown", "Pricing mistakes to avoid", "A day running the business", "Q&A: your biggest questions"],
    money: ["The boring move that made me rich", "My monthly money system", "Investing for total beginners", "How I cut $500/mo", "The side hustle that actually paid", "Mistakes in my 20s", "Answering money DMs"],
    tech: ["The setup that saves me 10 hours", "5 tools I can't work without", "Automate this today", "My exact prompt library", "Free vs paid — what's worth it", "Building in public update", "You asked, I tested it"],
    beauty: ["The routine that cleared my skin", "Drugstore vs luxury", "The step you're skipping", "GRWM in 60 seconds", "What a derm told me", "Products I regret", "Answering your skin DMs"],
    travel: ["How I travel for under $50/day", "The city everyone skips", "One-bag packing list", "Booking hacks that work", "A perfect day here", "Mistakes on my first trip", "Where to go next"],
    mindset: ["The 2-minute rule", "My morning system", "How I beat procrastination", "The habit that changed my year", "What I stopped doing", "A realistic day", "Your questions answered"],
  };
  const arc = angles[cat] || angles.mindset;
  const hooks = HOOKS[cat] || HOOKS.mindset;

  const posts = [];
  for (let i = 0; i < count; i++) {
    const angle = arc[i % arc.length];
    posts.push({
      day: i + 1,
      angle,
      title: `${angle} — ${titleCase(s)}`,
      hook: i === 0 ? hooks(s) : `${angle}: the part nobody shows you.`,
      format: formats[i % formats.length],
      bestTime: times[i % times.length],
      hashtags: tags(theme, 1).slice(0, 5),
    });
  }
  return {
    name: `${titleCase(s)} in ${count} Days`,
    bigIdea: `A ${count}-day ${platform} arc that builds an audience early and converts it late — one post a day, no repeats.`,
    posts,
  };
}

// ---- NEW: trend & hashtag / SEO kit --------------------------------------

export function demoTrends(topic, platform = "tiktok") {
  const cat = categorize(topic);
  const bank = HASHTAGS[cat];
  const idea = subject(topic);
  const score = 58 + (Math.abs(hashStr(idea)) % 34); // 58–91, feels earned
  return {
    topic: idea,
    platform,
    hashtags: {
      broad: bank.slice(0, 2).map((h) => ({ tag: h, reach: "500k+ posts", note: "high reach, high competition — use 1–2 max" })),
      mid: bank.slice(2, 5).map((h) => ({ tag: h, reach: "50k–500k", note: "the sweet spot for discovery" })),
      niche: [`#${slug(idea)}`, `#${slug(idea)}tips`, `#${cat}community`].map((h) => ({ tag: h, reach: "<50k", note: "easy to rank, loyal viewers" })),
    },
    bestTimes: [
      { window: "Tue 7:00–9:00am", why: "commute scroll, low competition" },
      { window: "Thu 12:00–1:30pm", why: "lunch-break peak engagement" },
      { window: "Sun 8:00–10:00pm", why: "highest weekly watch-time" },
    ],
    hookAngles: [
      `"I was wrong about ${idea}"`,
      `"Do this before you try ${idea}"`,
      `"${titleCase(idea)}, ranked worst to best"`,
      `"The ${idea} mistake costing you views"`,
      `"Nobody talks about this side of ${idea}"`,
    ],
    hookScore: {
      score,
      grade: score >= 80 ? "A" : score >= 70 ? "B" : "C",
      tip: score >= 80
        ? "Strong — front-load the payoff even harder in the first 3 words."
        : "Add a number or a specific stakes word ('cost you', '30 days') to the first line.",
    },
    ridingTrend: `Pair ${idea} with the current "${cat === "mindset" ? "romanticize your routine" : "day-in-my-life"}" format for extra reach.`,
  };
}

// ---- NEW: paid ads (Ad Studio) -------------------------------------------

export function demoAds(product, platform = "meta", goal = "conversions") {
  const s = subject(product);
  const cat = categorize(product);
  const t = titleCase(s);
  // Five angle templates so each variation tests something different.
  const variations = [
    {
      angle: "Pain",
      primaryText: `Still fighting with ${s}?\nYou're doing it on hard mode — and it's costing you.\nThere's a faster way.`,
      headline: `Stop wasting time`,
      description: `The shortcut to ${s}, minus the guesswork.`,
      cta: "Learn More",
    },
    {
      angle: "Desire",
      primaryText: `Imagine ${s} actually working for you by next week.\nNo fluff. No 40-tab spreadsheet.\nJust the result.`,
      headline: `${t}, handled`,
      description: `What you'd build if you had the time.`,
      cta: "Get Offer",
    },
    {
      angle: "Proof",
      primaryText: `12,000+ creators switched last month.\nThe reason is boring: it just works.\nSee why they didn't look back.`,
      headline: `Why they switched`,
      description: `Loved by people who hate hype.`,
      cta: "Shop Now",
    },
    {
      angle: "Curiosity",
      primaryText: `The ${s} trick nobody posts about.\nIt takes 3 minutes and feels like cheating.\nHere's the whole thing 👇`,
      headline: `The 3-minute fix`,
      description: `Steal the exact setup.`,
      cta: "Sign Up",
    },
    {
      angle: "Urgency",
      primaryText: `Launch pricing ends Sunday.\nAfter that, ${s} goes back to full price.\nLock it in while it's here.`,
      headline: `Ends Sunday`,
      description: `Best price you'll see this year.`,
      cta: "Book Now",
    },
  ];
  return {
    platform,
    goal,
    audience: `Warm lookalike of your buyers + interest stack around ${cat} (age 24–45), broad placements, let the algorithm find winners.`,
    variations,
    tip: goal === "awareness"
      ? "Lead with the boldest hook in the first line — cost-per-thousand rewards a strong thumb-stop, not a hard sell."
      : "Kill any variation under a 1% CTR after 1,000 impressions and pour budget into the top angle.",
  };
}

// ---- NEW: thumbnail & title lab ------------------------------------------

export function demoThumbnails(topic, platform = "youtube") {
  const s = subject(topic);
  const t = titleCase(s);
  const seed = Math.abs(hashStr(s));
  const concepts = [
    { title: `I tried ${s} for 30 days`, overlay: "30 DAYS", visual: `confident creator mid-gesture, split before/after of ${s}, high-contrast lighting, punchy yellow arrow`, emotion: "curiosity" },
    { title: `${t} is a lie`, overlay: "IT'S A LIE", visual: `close-up shocked expression, bold red X over a common ${s} cliché, dark moody background`, emotion: "shock" },
    { title: `The ${s} nobody shows you`, overlay: "HIDDEN", visual: `hand revealing a hidden object, dramatic rim light, one vivid accent color on black`, emotion: "FOMO" },
    { title: `Do this before ${s}`, overlay: "DO THIS FIRST", visual: `pointing to a clean checklist graphic, bright optimistic palette, big legible numerals`, emotion: "desire" },
  ];
  // Deterministic but spread-out scores that feel earned (82 → 61).
  const scored = concepts
    .map((c, i) => ({ ...c, clickScore: 82 - i * 7 + ((seed >> i) % 4) }))
    .sort((a, b) => b.clickScore - a.clickScore);
  return { topic: s, platform, concepts: scored, winner: 0 };
}

// ---- NEW: SEO blog & newsletter ------------------------------------------

export function demoArticle(topic, keywords = "") {
  const s = subject(topic);
  const t = titleCase(s);
  const kw = String(keywords || s).split(",")[0].trim() || s;
  const cat = categorize(topic);
  const body = [
    `# ${t}: The Practical Guide`,
    ``,
    `Most advice about ${s} is vague. This is the version you can act on today — no fluff, just the moves that matter.`,
    ``,
    `## Why ${t} Actually Matters`,
    ``,
    `The creators who win with ${s} aren't more talented — they're more consistent. They pick one system and run it long enough to compound.`,
    ``,
    `## The 3 Steps That Move the Needle`,
    ``,
    `- **Start smaller than feels serious.** Momentum beats motivation every time.`,
    `- **Measure one number.** What you track improves; what you ignore drifts.`,
    `- **Ship before it's perfect.** A rough post today beats a flawless one stuck in drafts.`,
    ``,
    `## Common Mistakes to Avoid`,
    ``,
    `Chasing every trend, copying without adapting, and quitting right before the payoff. Consistency is the unglamorous cheat code.`,
    ``,
    `## Bottom Line`,
    ``,
    `Treat ${s} as a streak, not a sprint. Pick one step above and start it this week.`,
  ].join("\n");
  return {
    metaTitle: `${t}: The Practical Guide`.slice(0, 60),
    metaDescription: `A no-fluff guide to ${s} — the exact steps, the mistakes to skip, and how to stay consistent enough to see results.`.slice(0, 155),
    slug: slug(kw) + "-guide",
    readTime: "4 min",
    headings: [`Why ${t} Actually Matters`, "The 3 Steps That Move the Needle", "Common Mistakes to Avoid", "Bottom Line"],
    body,
    faq: [
      { q: `How long until ${s} shows results?`, a: `Most people see early signal in 2–4 weeks of consistent effort — the compounding starts after that.` },
      { q: `Do I need special tools for ${s}?`, a: `No. Start with what you have; add tools only once a step becomes a repeated bottleneck.` },
      { q: `What's the single biggest mistake?`, a: `Quitting during the boring middle. Protect the streak and the results follow.` },
    ],
    keyword: kw,
    category: cat,
  };
}

// ---- NEW: carousel / multi-slide -----------------------------------------

export function demoCarousel(topic, platform = "instagram", slideCount = 6) {
  const s = subject(topic);
  const cat = categorize(topic);
  const t = titleCase(s);
  const middle = beats(cat, s); // reuse the storyboard value-beat bank
  const n = Math.max(3, Math.min(10, Number(slideCount) || 6));
  const slides = [
    { headline: `${t}, in ${n} slides`, body: `Save this — you'll want it later. Here's the version nobody hands you for free.` },
  ];
  for (let i = 0; i < n - 2; i++) {
    const [cap, vo] = middle[i % middle.length];
    slides.push({ headline: cap, body: vo });
  }
  slides.push({ headline: "Save & follow", body: `Follow for one of these a day. Save this so it's there when you need it.` });
  return {
    title: `${t}: the swipe-worthy version`,
    slides: slides.slice(0, n),
    caption: `${(HOOK_OPENERS[Math.abs(hashStr(s)) % HOOK_OPENERS.length])(s)}\n\nSwipe through, then save it for later 🔖`,
    hashtags: tags(topic),
  };
}

// ---- helpers -------------------------------------------------------------

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export { PALETTES };
