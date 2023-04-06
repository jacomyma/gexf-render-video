import { Command } from 'commander';
import { DOMParser } from 'xmldom';
import { readFileSync } from 'fs';
import { getLogger } from "./-get-logger.js"
import * as fs from "fs";
import Graph from "graphology";
import gexf from "graphology-gexf";
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

// CLI logic
let program, options
program = new Command();
program
	.name('layout-slices')
	.description('Compute layout for slices')
  .option('-i, --input <file>', 'Slices JSON file (default: slices.json)')
  .option('-s, --sample <slice>', 'Samples a single slice. Use it to tune settings more quickly.')
  .showHelpAfterError()
  .parse(process.argv);

options = program.opts();

// Logger
const logger = getLogger(`log/${program.name()}.log`)
logger.level = "debug"

// Load slices
const slicesFile = options.input || "slices.json"
let slicesJson, data
try {
  slicesJson = fs.readFileSync(slicesFile, 'utf8');
  data = JSON.parse(slicesJson);
  logger.info(`Input file loaded: ${slicesFile}. It contains ${data.slices.length} slices.`)
} catch (err) {
  logger.error(`Error loading input file ${slicesFile}.\n${err}`)
}

if (options.sample) {
  // Sample a single slice
  // Check that the slice is in the range
  if (options.sample < 0 || options.sample > data.slices.length) {
    logger.error(`The sampled slice (${options.sampe} must be in the [0,${data.slices.length}] range.)`)
    process.exit()
  } else {
    logger.info(`Sample slice ${options.sample}.`)



  }
} else {

}