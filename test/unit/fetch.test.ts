import { isUrl, stripHtml } from "../../src/utils/fetch.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function run() {
  console.log("═══ Fetch Utils Unit Tests ═══\n");

  // ─── isUrl ───────────────────────────────────────────

  assert(isUrl("https://example.com"), "isUrl: https");
  assert(isUrl("http://example.com"), "isUrl: http");
  assert(isUrl("HTTPS://EXAMPLE.COM"), "isUrl: case-insensitive");
  assert(isUrl("  https://example.com  "), "isUrl: trimmed whitespace");
  assert(!isUrl("example.com"), "isUrl: no protocol → false");
  assert(!isUrl("ftp://example.com"), "isUrl: ftp → false");
  assert(!isUrl("not a url"), "isUrl: plain text → false");
  assert(!isUrl(""), "isUrl: empty → false");
  assert(!isUrl("/path/to/file.txt"), "isUrl: file path → false");
  assert(!isUrl("https"), "isUrl: incomplete → false");

  // ─── stripHtml ───────────────────────────────────────

  // Basic tag removal
  assert(stripHtml("<p>Hello</p>") === "Hello", "stripHtml: removes p tags");
  assert(
    stripHtml("<b>bold</b> text") === "bold text",
    "stripHtml: removes inline tags",
  );

  // Script/style removal
  assert(
    !stripHtml("<script>alert('xss')</script>Content").includes("alert"),
    "stripHtml: removes scripts",
  );
  assert(
    !stripHtml("<style>.red{color:red}</style>Content").includes("color"),
    "stripHtml: removes styles",
  );

  // Nav/footer removal
  assert(
    !stripHtml("<nav>Menu items</nav>Main content").includes("Menu"),
    "stripHtml: removes nav",
  );
  assert(
    !stripHtml("<footer>Copyright</footer>Main").includes("Copyright"),
    "stripHtml: removes footer",
  );

  // Entity decoding
  assert(
    stripHtml("&amp; &lt; &gt; &quot; &#39;") === "& < > \" '",
    "stripHtml: decodes HTML entities",
  );
  assert(stripHtml("&nbsp;") === "", "stripHtml: decodes nbsp");

  // Whitespace collapsing
  assert(
    !stripHtml("a   b   c").includes("   "),
    "stripHtml: collapses multiple spaces",
  );
  assert(
    !stripHtml("a\n\n\n\nb").includes("\n\n\n"),
    "stripHtml: collapses multiple newlines",
  );

  // Empty/trivial input
  assert(stripHtml("") === "", "stripHtml: empty string");
  assert(
    stripHtml("plain text") === "plain text",
    "stripHtml: plain text unchanged",
  );

  // Real-world HTML snippet
  {
    const html = `<html><head><title>Test</title><style>body{}</style></head>
      <body><nav><a href="/">Home</a></nav>
      <h1>Hello World</h1><p>This is a <strong>test</strong> page.</p>
      <script>console.log('hi')</script>
      <footer>© 2024</footer></body></html>`;
    const text = stripHtml(html);
    assert(
      text.includes("Hello World"),
      "stripHtml real: preserves heading text",
    );
    assert(text.includes("test"), "stripHtml real: preserves body text");
    assert(!text.includes("console.log"), "stripHtml real: no script content");
    assert(!text.includes("body{}"), "stripHtml real: no style content");
    assert(!text.includes("Home"), "stripHtml real: no nav content");
    assert(!text.includes("© 2024"), "stripHtml real: no footer content");
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
