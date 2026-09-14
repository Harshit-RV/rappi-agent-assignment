
import { runAgent } from '../src/index.js';

function truncate(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

async function main() {
  console.log('=== Agent trace ===');

  const summary = await runAgent({
    prompt: 'What is the current time in Asia/Kolkata? Answer in one sentence.',
    on: {
      onToolCall: (call) => console.log(`  -> ${call.name}`, JSON.stringify(call.args)),
      onToolResult: (result) =>
        console.log(
          `  <- ${result.name} ${result.isError ? 'ERROR' : 'ok'} (${result.durationMs}ms) ${truncate(result.content)}`
        ),
      onAssistantMessage: (text) => console.log(`  [assistant] ${truncate(text, 400)}`),
    },
  });

  console.log('\n=== Run summary ===');
  console.log(`Stop reason: ${summary.stopReason}`);
  console.log(`Iterations:  ${summary.iterations}`);
  console.log(`Duration:    ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log(`\nFinal answer: ${summary.finalText}`);

  if (summary.stopReason !== 'SUCCESS') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
