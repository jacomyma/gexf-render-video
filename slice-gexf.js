import { Command } from 'commander';
import { DOMParser } from 'xmldom';
import { readFileSync } from 'fs';
import { getLogger } from "./-get-logger.js"

/// CLI logic
let program, options
program = new Command();
program
	.name('slice-gexf')
	.description('Slice a GEXF over time')
  .requiredOption('-i, --input <file>', 'GEXF file input (required)')
  .option('-w, --window <seconds>', 'Window range for each slice. In seconds or unitless depending on the time format of the GEXF. Defaults to 1 week (7*24*60*60 seconds) or 1.')
  .option('-s, --step <seconds>', 'How much time passes from one slice to the next. In seconds or unitless depending on the time format of the GEXF. Defaults to 1 day (24*60*60 seconds) or 0.1.')
  .showHelpAfterError()
  .parse(process.argv);

options = program.opts();

// Logger
const logger = getLogger(`log/${program.name}.log`)
// logger.level = "debug"

// Parse GEXF
const xmlFile = readFileSync(options.input, 'utf8');
const parser = new DOMParser();
const doc = parser.parseFromString(xmlFile);
const gexfDomnode = doc.getElementsByTagName("gexf").item(0)
const gexfVersion = gexfDomnode.getAttribute("version")
const graphNode = gexfDomnode.getElementsByTagName("graph").item(0)

/// CHECKS
// Check GEXF version
if (gexfVersion !== "1.3") {
  logger.warn(`GEXF version is ${gexfVersion}. Current code is designed for version 1.3, so this version might not be supported.`)
}

// Check if dynamic
if (graphNode.getAttribute("mode") !== "dynamic") {
  logger.error(`The GEXF is not dynamic, which is currently not supported.`)
  process.exit()
}

// Check which time format to use
const timeformat = graphNode.getAttribute("timeformat")
let timeFormatter
if (timeformat == "date") {
  logger.info(`GEXF time format is "date". Expecting time formatted as "YYYY-MM-DD".`)
  timeFormatter = function(date) {
    const msec = Date.parse(date)
    return msec
  }
} else if (timeformat == "dateTime") {
  logger.info(`GEXF time format is "dateTime". Expecting time formatted as "YYYY-MM-DDTHH:mm:ss.sssZ".`)
  timeFormatter = function(datetime) {
    const msec = Date.parse(datetime)
    return msec
  }
} else if (timeformat == "integer") {
  logger.info(`GEXF time format is "integer". Expecting time formatted as a natural number.`)
  timeFormatter = function(integer) {
    return +integer
  }
} else if (timeformat == "double") {
  logger.info(`GEXF time format is "double". Expecting time formatted as a decimal number.`)
  timeFormatter = function(double) {
    return +double
  }
} else {
  logger.error(`GEXF time format is "${timeformat}" and is not currently supported.`)
  process.exit()
}