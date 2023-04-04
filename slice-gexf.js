import { Command } from 'commander';

/// CLI logic
let program, options
program = new Command();
program
	.name('slice-gexf')
	.description('Slice a GEXF over time')
  .requiredOption('-i, --input <file>', 'GEXF file input (required)')
  .option('-w, --window <seconds>', 'Window range, in secondes, for each slice. Defaults to 1 week (7*24*60*60 seconds)')
  .option('-s, --step <seconds>', 'How much tims passes from one slice to the next. Defaults to 1 day (24*60*60 seconds)')
  .showHelpAfterError()
  .parse(process.argv);

options = program.opts();



