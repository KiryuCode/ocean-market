
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = process.argv[2] || "A:\\grokbot-lab\\ocean-market";
const configPath = path.join(root, "config.js");
const appPath = path.join(root, "app.js");
const dbPath = path.join(root, "data", "ocean.sqlite");

const img = (id) => `https://images.unsplash.com/${id}?w=900&h=700&fit=crop`;

const IMAGES = {
  "anubias-nana": img("photo-1524704654690-b56c05c78a00"),
  "java-fern": img("photo-1571752726703-5e7d1f6a986d"),
  "amazon-sword": img("photo-1610448721566-47369c768e70"),
  "dwarf-hairgrass": img("photo-1551244072-5d12893278ab"),
  "crypt-wendtii": img("photo-1524704796725-9fc3084b4ce3"),
  "water-wisteria": img("photo-1473496169904-658ba7c44d8a"),
  "red-tiger-lotus": img("photo-1459411552884-841db9b3cc2a"),
  "bucephalandra-kedagang": img("photo-1466692476866-aef1dfb1e735"),
  "monte-carlo": img("photo-1416879595882-3373a0480b5b"),
  "jungle-val": img("photo-1509423350716-97f9360b4e09"),
  "green-star-polyps": img("photo-1546026423-cc4642628d2b"),
  "pulsing-xenia": img("photo-1582967788606-a171c1080cb0"),
  "toadstool-leather": img("photo-1541625602330-2277a4c46182"),
  "kenya-tree": img("photo-1559825481-12a05cc00344"),
  "rhodactis-mushroom": img("photo-1682687220742-aba13b6e50ba"),
  "hammer-coral": img("photo-1583212292454-1fe6229603b7"),
  "holy-grail-torch": img("photo-1559827260-dc66d52bef19"),
  "frogspawn": img("photo-1682687982501-1e58ab814714"),
  "acan-lord": img("photo-1544551763-77ef2d0cfc6c"),
  "scoly-master": img("photo-1505118380757-91f5f5632de0"),
  "acropora-millepora": img("photo-1513553404607-988bf2703777"),
  "montipora-cap": img("photo-1468581263533-11e2d3bb7133"),
  "pink-stylophora": img("photo-1471922694854-ff1b63b51df3"),
  "birds-nest": img("photo-1505765050516-f72dcac9c60e"),
  "zoa-fruit-loop": img("photo-1615751072497-5f5169febe17"),
  "zoa-orange-bam-bam": img("photo-1500375592092-40eb2168fd21"),
  "rose-bubble-tip": img("photo-1560275619-4662e36fa65c"),
  "rock-flower-anemone": img("photo-1437622368342-7a3d73a501c8"),
  "ocellaris-pair": img("photo-1535591273668-578e31182c4f"),
  "fire-shrimp": img("photo-1618044733300-9472054094ee"),
  "nassarius-five": img("photo-1544551763-46a013bb70d5"),
  "blue-tang-juvenile": img("photo-1516684669134-de6f7c473a2a"),
  "fiji-live-rock": img("photo-1476673160081-cf065307f653"),
  "reef-salt-160": img("photo-1576091160399-112ba8d25d1d"),
  "master-test-kit": img("photo-1532187863486-abf9dbad1b69"),
  "frozen-mysis-10": img("photo-1581091226825-a6a2a5aee158"),
  "reef-led-24": img("photo-1518770660439-4636190af475"),
  "protein-skimmer-nano": img("photo-1504328345606-18bbc8c9d7d1"),
};

const DESCS = {
  "anubias-nana": "Thick, slow leaves that shrug off neglect. Tie the rhizome to rock or wood — bury it and it sulks.",
  "java-fern": "The plant you give a new tank. Attach it, leave it, watch the runners write across the hardscape.",
  "amazon-sword": "A background rosette with an appetite. Heavy root tabs, and it will fill a wall of green.",
  "dwarf-hairgrass": "Fine grass for a bright foreground. CO2 turns scattered plugs into a single lawn.",
  "crypt-wendtii": "Bronze crypt that melts after a move, then comes back denser than you planted it.",
  "water-wisteria": "A nitrate sponge on a stem. Pinch the tops and it bushes; ignore it and it still works.",
  "red-tiger-lotus": "A bulb that throws mottled red pads. Trim the runners if you want a single centerpiece.",
  "bucephalandra-kedagang": "Iridescent epiphyte for low-tech hardscape. Slow, stubborn, and worth the wait.",
  "monte-carlo": "Tiny leaves, bright green carpet. High light and CO2 — otherwise it climbs instead of creeps.",
  "jungle-val": "Tall tape-grass that colonizes by runners. Softens the back glass of a display.",
  "green-star-polyps": "Neon polyps that encrust a plug and then the rock. Easy flow, moderate light, give it a border.",
  "pulsing-xenia": "The coral that waves back. Fast — park it on a frag island before it takes the wall.",
  "toadstool-leather": "A ruffled leather cap that sheds a waxy film as it grows. Classic first softie.",
  "kenya-tree": "Branching filler that drops baby colonies. Low-maintenance and a little invasive, in a good way.",
  "rhodactis-mushroom": "A juicy disc for the lower ledges. Sit it on rubble, never loose on sand.",
  "hammer-coral": "Branching hammers that want a sway, not a thrash. Keep calcium honest and neighbors at a distance.",
  "holy-grail-torch": "Gold-tipped torch heads with long sweepers. Give it a throne and empty water around it.",
  "frogspawn": "Grape-like LPS branches under moderate light. Stable alk, gentle flow, no sudden chemistry.",
  "acan-lord": "Meaty, painted LPS for a low ledge. Mild, indirect flow — it sulks in a blast.",
  "scoly-master": "A showpiece disk. Low light, low flow, and the kind of alkalinity you write down.",
  "acropora-millepora": "SPS table coral for tanks that already have a routine. High light, chaotic flow, patience.",
  "montipora-cap": "Plating monti that fans into a shelf. The forgiving first SPS if the lights are real.",
  "pink-stylophora": "A tight pink bush for the high-PAR corner. Strong random flow keeps the slime off.",
  "birds-nest": "Fine-branching Seriatopora that grows like it has somewhere to be. Mixed-reef friendly SPS.",
  "zoa-fruit-loop": "Candy-ring zoas on a gold-mouth frag. Handle like palytoxin is real — because it is.",
  "zoa-orange-bam-bam": "A blazing orange colony that photographs itself. Dip the frag; give it moderate light.",
  "rose-bubble-tip": "The clown host everyone means. Mature tank, a powerhead nearby, and a quarantine first.",
  "rock-flower-anemone": "A stay-put mini for the sandbed. Color without the midnight walkabout of a BTA.",
  "ocellaris-pair": "Captive-bred pair, reef-safe, already arguing over a rock. Ready to host when you are.",
  "fire-shrimp": "Lysmata debelius — shy the first week, tank mascot the second. Keep a cave it can claim.",
  "nassarius-five": "Five sand-sifters that bury between meals. They need a sandbed, not bare glass.",
  "blue-tang-juvenile": "A young Paracanthurus. Large, established system, daily nori, and room to cruise.",
  "fiji-live-rock": "Porous base rock sold by the pound. Rinse, cure, then let it become the skeleton of the reef.",
  "reef-salt-160": "Balanced mix for a 160-gallon batch of mixed reef. Mix to 1.025, aerate, then use.",
  "master-test-kit": "Alk, calcium, mag, nitrate, phosphate. Test weekly. Write the numbers down.",
  "frozen-mysis-10": "PE mysis cubes. Thaw in tank water; keep the melt water out of the display.",
  "reef-led-24": "Full-spectrum fixture with a sunset ramp. Hang or brace it over a 24-inch rim.",
  "protein-skimmer-nano": "Quiet in-sump skimmer for 20–40 gallon reefs. Empty the cup before it tells on you.",
};

let config = fs.readFileSync(configPath, "utf8");
config = config.replace(
  /const STORE_TAGLINE = "[^"]*";/,
  'const STORE_TAGLINE = "Live reef. Honest packing. Overnight.";'
);
config = config.replace(
  /const PLACEHOLDER_IMAGE =\s*"[^"]*";/,
  `const PLACEHOLDER_IMAGE =\n  "${img("photo-1582967788606-a171c1080cb0")}";`
);

for (const [id, url] of Object.entries(IMAGES)) {
  const re = new RegExp(`(id: "${id}"[\\s\\S]*?image: ")[^"]+(")`);
  if (!re.test(config)) {
    console.warn("no image slot for", id);
    continue;
  }
  config = config.replace(re, `$1${url}$2`);
}
for (const [id, desc] of Object.entries(DESCS)) {
  const re = new RegExp(`(id: "${id}"[\\s\\S]*?description: ")[^"]+(")`);
  if (!re.test(config)) {
    console.warn("no desc slot for", id);
    continue;
  }
  config = config.replace(re, `$1${desc.replace(/"/g, '\\"')}$2`);
}
fs.writeFileSync(configPath, config);
console.log("patched config.js");

let app = fs.readFileSync(appPath, "utf8");
const oldStatic = `app.get("/about", renderStaticPage("about", "About Ocean Market", [
  "Ocean Market is a reef shop for planted tanks and mixed reefs — livestock, coral, and the gear to keep them.",
  "We pack live animals for overnight shipping and stand behind arrivals. Copy and photography on this page are owned by design.",
]));
app.get("/contact", renderStaticPage("contact", "Contact", [
  "Questions about an order or a species? Email the address on your receipt and include the order ID.",
  "Social placeholders live in the footer until the real profiles are ready.",
]));
app.get("/shipping", renderStaticPage("shipping", "Shipping", [
  "Live livestock ships overnight early in the week so nothing sits over a weekend.",
  "Weather holds happen in heat waves and freezes. We'll wait rather than cook or freeze a bag.",
]));
app.get("/returns", renderStaticPage("returns", "Returns", [
  "Livestock is covered by a live-arrival guarantee: photo of the unopened bag on the day it lands.",
  "Unopened dry goods can come back within 30 days. Used test kits and opened salt are final sale.",
]));
app.get("/care", renderStaticPage("care", "Care guides", [
  "Plants: most of our stems and rhizomes are low-tech friendly. Don't bury Anubias or Java fern rhizomes.",
  "Softies and zoas are the on-ramp. LPS wants stable alk. SPS wants that plus strong light and flow.",
  "Anemones belong in mature tanks. Quarantine fish. Dip corals. Test weekly.",
]));`;

const newStatic = `app.get("/about", renderStaticPage("about", "About Ocean Market", [
  "We are a small reef shop that sells what we would put in our own tanks: planted-tank stems and rhizomes, softies, LPS, SPS, zoas, anemones, a short list of livestock, and the salt and tests that keep them.",
  "The catalog is not a warehouse dump. Every coral is dipped. Fish sit in quarantine. Plants ship emersed or submerged depending on the species, never as an afterthought in a livestock box.",
  "If a heat wave or a freeze is sitting on the airport, we hold the order. A late box is better than a cooked one.",
]));
app.get("/contact", renderStaticPage("contact", "Contact", [
  "Questions about a species, a hold, or an order: write the address on your receipt and put the order ID in the subject.",
  "We read mail in the morning before packs go out. Livestock questions get a real answer, not a script.",
  "Instagram, YouTube, and Facebook are placeholders in the footer until the shop profiles are live.",
]));
app.get("/shipping", renderStaticPage("shipping", "Shipping", [
  "Live animals and corals leave early in the week, overnight, so nothing sits in a depot over Saturday.",
  "Plants and dry goods can ship separately if you want them cheaper and slower. We will not mix a clownfish with a four-day ground box.",
  "Weather holds are not optional. If the route is too hot or too cold, we wait and we tell you. Heat packs and cold packs go in when the forecast earns them.",
]));
app.get("/returns", renderStaticPage("returns", "Returns", [
  "Livestock and coral carry a live-arrival guarantee. Photograph the unopened bag on the day it lands, then write us before you acclimate if something is wrong.",
  "Unopened dry goods can come back within 30 days for a refund of the item, not the freight.",
  "Opened salt, used test kits, and livestock that arrived healthy are final sale. We will still help you keep them.",
]));
app.get("/care", renderStaticPage("care", "Care guides", [
  "Plants: most of our stems and rhizomes are low-tech friendly. Never bury an Anubias, Java fern, or Buce rhizome — tie it. Swords and crypts want root tabs. Hairgrass and Monte Carlo want light, or they climb.",
  "Soft corals and zoas are the honest on-ramp. Moderate light, some flow, and a weekly test. Dip new frags. Palytoxin is not a joke; gloves and no boiling zoa rocks.",
  "LPS wants stable alkalinity more than fancy lights. Leave space for sweepers. SPS wants that plus strong, messy flow and a lighting schedule you do not keep changing.",
  "Anemones belong in mature tanks. Quarantine fish. Feed mysis like you mean it. Skim, test, and water-change on a calendar, not a vibe.",
]));`;

if (!app.includes('app.get("/about"')) {
  console.error("about route missing");
  process.exit(1);
}
if (app.includes(oldStatic)) {
  app = app.replace(oldStatic, newStatic);
} else {
  console.warn("exact static block mismatch; trying looser replace");
  app = app.replace(/app\.get\("\/about"[\s\S]*?app\.get\("\/care", renderStaticPage\([\s\S]*?\]\);/, newStatic);
}
fs.writeFileSync(appPath, app);
console.log("patched app.js");

const esc = (s) => String(s).replace(/'/g, "''");
const sql = Object.keys(IMAGES).map((id) => {
  const parts = [`UPDATE products SET image='${esc(IMAGES[id])}'`];
  if (DESCS[id]) parts[0] += `, description='${esc(DESCS[id])}'`;
  return `${parts[0]} WHERE id='${esc(id)}';`;
}).join("\n");
fs.writeFileSync(path.join(root, "scripts", "bb5-visual-seed.sql"), sql);
try {
  execSync(`sqlite3 "${dbPath}" ".read ${path.join(root, "scripts", "bb5-visual-seed.sql").replace(/\\/g, "/")}"`, {
    stdio: "inherit",
  });
  console.log("sqlite updated");
} catch (err) {
  console.error("sqlite update failed", err.message);
  process.exitCode = 1;
}
