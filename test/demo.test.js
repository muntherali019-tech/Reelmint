import test from "node:test";
import assert from "node:assert/strict";
import {
  categorize,
  demoStoryboard,
  demoCaptions,
  demoClips,
  demoCampaign,
  demoTrends,
  demoDesign,
} from "../server/demo.js";

// The demo engine is what makes a keyless deploy feel like a real product — so
// its output must be well-formed, topic-aware, and free of "lorem"/"demo mode".

const NOT_PLACEHOLDER = (s) => {
  const t = String(s).toLowerCase();
  assert.ok(!t.includes("lorem"), `should not contain lorem: ${s}`);
  assert.ok(!t.includes("demo mode"), `should not contain "demo mode": ${s}`);
  assert.ok(!t.includes("add your anthropic"), `should not nag about API key: ${s}`);
};

test("categorize maps topics to sensible content buckets", () => {
  assert.equal(categorize("best gym workout for abs"), "fitness");
  assert.equal(categorize("cold brew coffee recipe"), "food");
  assert.equal(categorize("how to invest and save money"), "money");
  assert.equal(categorize("random unmatched words"), "mindset"); // graceful default
});

test("demoStoryboard is well-formed, topic-aware and real-sounding", () => {
  const sb = demoStoryboard("cold brew coffee at home", 5, { platform: "tiktok", tone: "energetic" });
  assert.equal(sb.scenes.length, 5);
  assert.ok(sb.title && sb.hook && Array.isArray(sb.hashtags) && sb.hashtags.length >= 3);
  NOT_PLACEHOLDER(sb.title + sb.hook + sb.description);
  for (const s of sb.scenes) {
    assert.ok(s.caption && s.voiceover && s.imagePrompt);
    NOT_PLACEHOLDER(s.caption + s.voiceover);
  }
  // The topic surfaces in the content.
  assert.ok((sb.hook + sb.description).toLowerCase().includes("coffee"));
});

test("demoStoryboard respects a range of scene counts", () => {
  assert.equal(demoStoryboard("x", 3).scenes.length, 3);
  assert.equal(demoStoryboard("x", 8).scenes.length, 8);
});

test("demoCaptions returns the requested count with hashtags", () => {
  const text = demoCaptions("launch day", "instagram", 4);
  const numbered = text.split("\n").filter((l) => /^\d+\./.test(l.trim()));
  assert.equal(numbered.length, 4);
  assert.ok(text.includes("#"));
  NOT_PLACEHOLDER(text);
});

test("demoClips returns the requested number of quoted clips", () => {
  const { clips } = demoClips("this is a fairly long transcript about shipping products fast and telling honest stories", 4);
  assert.equal(clips.length, 4);
  for (const c of clips) {
    assert.ok(c.title && c.hook && c.quote && Array.isArray(c.hashtags));
  }
});

test("demoCampaign returns a named plan with one post per day", () => {
  const c = demoCampaign("start strength training", 7, { platform: "tiktok" });
  assert.ok(c.name && c.bigIdea);
  assert.equal(c.posts.length, 7);
  c.posts.forEach((p, i) => {
    assert.equal(p.day, i + 1);
    assert.ok(p.title && p.hook && p.format && p.bestTime && Array.isArray(p.hashtags));
  });
});

test("demoTrends returns tiered hashtags and a bounded hook score", () => {
  const t = demoTrends("morning productivity", "tiktok");
  assert.ok(t.hashtags.broad.length && t.hashtags.mid.length && t.hashtags.niche.length);
  assert.ok(t.bestTimes.length >= 3 && t.hookAngles.length >= 3);
  assert.ok(t.hookScore.score >= 0 && t.hookScore.score <= 100);
  assert.ok(["A", "B", "C"].includes(t.hookScore.grade));
});

test("demoDesign returns a palette and a short headline", () => {
  const d = demoDesign("neon quote card discipline beats motivation", "neon");
  assert.ok(d.headline && d.headline.length <= 42);
  assert.ok(d.palette && d.palette.bg && d.palette.accent);
  assert.ok(["center", "lower", "split"].includes(d.layout));
});
