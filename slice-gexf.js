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
  .option('-r, --range <number>', 'Temporal range (window) for each slice. In seconds or unitless depending on the time format of the GEXF. Defaults to 1 week (7*24*60*60 seconds) or 1.')
  .option('-s, --step <number>', 'How much time passes from one slice to the next. In seconds or unitless depending on the time format of the GEXF. Defaults to 1 day (24*60*60 seconds) or 0.1.')
  .showHelpAfterError()
  .parse(process.argv);

options = program.opts();

// Logger
const logger = getLogger(`log/${program.name}.log`)
logger.level = "debug"

// Parse GEXF
const xmlFile = readFileSync(options.input, 'utf8');
const parser = new DOMParser();
const doc = parser.parseFromString(xmlFile);
const gexfDomnode = doc.getElementsByTagName("gexf").item(0)
const gexfVersion = gexfDomnode.getAttribute("version")
const graphDomnode = gexfDomnode.getElementsByTagName("graph").item(0)
const nodesDomnode = graphDomnode.getElementsByTagName("nodes").item(0)

/// CHECKS
// Check GEXF version
if (gexfVersion !== "1.3") {
  logger.warn(`GEXF version is ${gexfVersion}. Current code is designed for version 1.3, so this version might not be supported.`)
}

// Check if dynamic
if (graphDomnode.getAttribute("mode") !== "dynamic") {
  logger.error(`The GEXF is not dynamic, which is currently not supported. GEXF mode: ${graphDomnode.getAttribute("mode") || "static"}.`)
  process.exit()
}

// Check which time format to use
const timeformat = graphDomnode.getAttribute("timeformat")
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
} else if (timeformat == "integer" || timeformat == "") {
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

// Check time representation
const timerepresentation = graphDomnode.getAttribute("timerepresentation")
if (timerepresentation == "interval" || timerepresentation == "") {
  logger.debug(`GEXF time representation is "interval".`)
} else if (timerepresentation == "timestamp") {
  logger.debug(`GEXF time representation is "timestamp".`)
} else {
  logger.error(`GEXF time representation is "${timerepresentation}" and is not currently supported.`)
  process.exit()
}

// Register which attributes are dynamic or static
let nodeAttributes = {}
let edgeAttributes = {}
const attributesDomnodes = graphDomnode.getElementsByTagName("attributes")
for (let i=0; i<attributesDomnodes.length; i++) {
  const attributesDomnode = attributesDomnodes.item(i)
  const attClass = attributesDomnode.getAttribute("class")
  const attMode = attributesDomnode.getAttribute("mode")
  const attributeDomnodes = attributesDomnode.getElementsByTagName("attribute")
  for (let j=0; j<attributeDomnodes.length; j++) {
    const attributeDomnode = attributeDomnodes.item(j)
    let attObj = {}
    attObj.id = attributeDomnode.getAttribute("id")
    attObj.title = attributeDomnode.getAttribute("title")
    attObj.type = attributeDomnode.getAttribute("type")
    if (attributeDomnode.getElementsByTagName("default") && attributeDomnode.getElementsByTagName("default").length > 0){
      attObj.default = attributeDomnode.getElementsByTagName("default").item(0).textContent
    }
    attObj.mode = attMode
    if (attClass == "node") {
      nodeAttributes[attObj.id] = attObj
    } else if (attClass == "edge") {
      edgeAttributes[attObj.id] = attObj
    }
    logger.debug(`Found ${attObj.mode} ${attClass} attribute "${attObj.id}". Type: ${attObj.type}. Title: ${attObj.title}.`)
  }
}

/// BUILD SLICES
// Find earliest and latest dates
let dateMin = Infinity
let dateMax = -Infinity
const nodeDomnodes = nodesDomnode.getElementsByTagName("node")
let pileDates
if (timerepresentation == "interval") {
  pileDates = function(domnode, dates){
    let start = domnode.getAttribute("start")
    if (start) {
      dates[start] = true
    }
    let end = domnode.getAttribute("end")
    if (end) {
      dates[end] = true
    }
  }
} else if (timerepresentation == "timestamp") {
  pileDates = function(domnode, dates){
    let timestamp = domnode.getAttribute("timestamp")
    if (timestamp) {
      dates[timestamp] = true
    }
  }
}
for (let i=0; i<nodeDomnodes.length; i++) {
  const nodeDomnode = nodeDomnodes.item(i)
  let dates = {}
  pileDates(nodeDomnode, dates)
  const spellsDomnode = nodeDomnode.getElementsByTagName("spells")
  if (spellsDomnode.length>0) {
    const spellDomnodes = spellsDomnode.item(0).getElementsByTagName("spell")
    for (let j=0; j<spellDomnodes.length; j++) {
      const spellDomnode = spellDomnodes.item(j)
      pileDates(spellDomnode, dates)
    }
  }
  dates = Object.keys(dates)
  dates.forEach(d => {
    const date = timeFormatter(d)
    dateMin = Math.min(dateMin, date)
    dateMax = Math.max(dateMax, date)
  })
}
logger.debug(`Time interval found: from ${dateMin} to ${dateMax}.`)
