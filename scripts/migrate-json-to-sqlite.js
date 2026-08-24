const store = require('../data/store');

async function main() {
  const data = await store.getRawData();
  const counts = Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => Array.isArray(value))
      .map(([name, value]) => [name, value.length])
  );
  console.log(JSON.stringify({
    ok: true,
    sqlitePath: store.getSqlitePath(),
    counts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
