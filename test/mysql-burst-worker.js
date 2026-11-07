/**
 * One checkout against a running server. Prints the HTTP status.
 * Used by the MySQL multi-process burst test.
 */
const base = process.env.BASE_URL;
const email = process.env.BURST_EMAIL;

function hidden(html, name) {
  const match = String(html).match(
    new RegExp("name=\"" + name + "\" value=\"([^\"]*)\"")
  );
  return match ? match[1] : "";
}

function csrf(html) {
  const match = String(html).match(/name="csrf-token" content="([^"]*)"/);
  return match ? match[1] : "";
}

async function main() {
  const page = await fetch(base + "/buy/basil");
  const setCookie = page.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  const html = await page.text();
  const res = await fetch(base + "/confirm", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie,
    },
    body: new URLSearchParams({
      _csrf: csrf(html),
      checkout_token: hidden(html, "checkout_token"),
      mode: "buy_now",
      product_id: "basil",
      email,
    }).toString(),
  });
  process.stdout.write(String(res.status));
  if (res.status >= 500) {
    const body = await res.text();
    process.stderr.write(body.slice(0, 500));
  }
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.stdout.write("0");
  process.exit(1);
});
