import { Command } from 'commander';
import { DOMParser } from 'xmldom';
import { readFileSync } from 'fs';
import { getLogger } from "./-get-logger.js"

// CLI logic
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
const nodeDomnodes = nodesDomnode.getElementsByTagName("node")
const edgesDomnode = graphDomnode.getElementsByTagName("edges").item(0)
const edgeDomnodes = edgesDomnode.getElementsByTagName("edge")


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
let timeParser, timeFormatter
if (timeformat == "date") {
  logger.info(`GEXF time format is "date". Expecting time formatted as "YYYY-MM-DD".`)
  timeParser = function(date) {
    const msec = Date.parse(date)
    return msec
  }
  timeFormatter = function(msec) {
    const date = new Date(msec)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
} else if (timeformat == "dateTime") {
  logger.info(`GEXF time format is "dateTime". Expecting time formatted as "YYYY-MM-DDTHH:mm:ss.sssZ".`)
  timeParser = function(datetime) {
    const msec = Date.parse(datetime)
    return msec
  }
  timeFormatter = function(msec) {
    const date = new Date(msec)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    const millisecondsFormatted = String(date.getMilliseconds()).padStart(3, '0')
    const timezoneOffset = date.getTimezoneOffset()
    const timezoneOffsetSign = timezoneOffset > 0 ? '-' : '+'
    const timezoneOffsetHours = String(Math.abs(Math.floor(timezoneOffset / 60))).padStart(2, '0')
    const timezoneOffsetMinutes = String(Math.abs(timezoneOffset % 60)).padStart(2, '0')
    const timezoneOffsetFormatted = timezoneOffsetSign + timezoneOffsetHours + ':' + timezoneOffsetMinutes
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millisecondsFormatted}${timezoneOffsetFormatted}`
  }
} else if (timeformat == "integer" || timeformat == "") {
  logger.info(`GEXF time format is "integer". Expecting time formatted as a natural number.`)
  timeParser = function(integer) {
    return +integer
  }
  timeFormatter = function(integer) {
    return String(integer)
  }
} else if (timeformat == "double") {
  logger.info(`GEXF time format is "double". Expecting time formatted as a decimal number.`)
  timeParser = function(double) {
    return +double
  }
  timeFormatter = function(double) {
    return String(double)
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
// Defaults
let windowRangeDefault
let windowStepDefault
let windowUnitRatio
if (timeformat == "date" || timeformat == "dateTime") {
  windowRangeDefault = 7*24*60*60 // seconds
  windowStepDefault = 24*60*60 // seconds
  windowUnitRatio = 1000 // seconds to milliseconds
} else {
  windowRangeDefault = 1 // arbitrary unit
  windowStepDefault = 0.1 // arbitrary unit
  windowUnitRatio = 1 // no conversion
}
let windowRange = (options.range?+options.range:windowRangeDefault)*windowUnitRatio
let windowStep = (options.range?+options.range:windowStepDefault)*windowUnitRatio

/// BUILD SLICES

// Find earliest and latest dates
let dateMin = Infinity
let dateMax = -Infinity
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
    const date = timeParser(d)
    dateMin = Math.min(dateMin, date)
    dateMax = Math.max(dateMax, date)
  })
}
logger.info(`Time range detected: from ${timeFormatter(dateMin)} to ${timeFormatter(dateMax)}.`)

// Build empty slices
let slices = []
for (let i = dateMin; i<=dateMax-windowRange; i+=windowStep){
  let slice = {
    start: i,
    end: i+windowRange,
    nodes:[],
    edges:[],
  }
  slices.push(slice)
}
logger.debug(`${slices.length} empty slices prepared.`)

// Overlap rule
let overlapDomnodeSlice
if (timerepresentation == "interval") {
  overlapDomnodeSlice = function(domnode, slice) {
    const start = domnode.getAttribute("start")
    const end = domnode.getAttribute("end")
    if (start || end) {
      let startDate
      if (start) {
        startDate = timeParser(start)
      } else {
        startDate = -Infinity
      }
      let endDate
      if (end) {
        endDate = timeParser(end)
      } else {
        endDate = Infinity
      }
      return !(endDate<slice.start || slice.end<startDate)
    }
  }
} else if (timerepresentation == "timestamp") {
  overlapDomnodeSlice = function(domnode, slice) {
    const timestamp = domnode.getAttribute("timestamp")
    if (timestamp) {
      const tsDate = timeParser(timestamp)
      return (slice.start<=tsDate && tsDate<slice.end)
    }
    return false
  }
}

// Fill slices with nodes
let checkNodeSlice
if (timerepresentation == "interval") {
  checkNodeSlice = function(nodeDomnode, slice) {
    let start = nodeDomnode.getAttribute("start")
    let end = nodeDomnode.getAttribute("end")
    if (start || end) {
      return overlapDomnodeSlice(nodeDomnode, slice)
    } else {
      let spellsDomnodeList = nodeDomnode.getElementsByTagName("spells")
      if (spellsDomnodeList.length>0) {
        let spellsDomnode = spellsDomnodeList.item(0)
        let spellDomnodes = spellsDomnode.getElementsByTagName("spell")
        for (let i=0; i<spellDomnodes.length; i++) {
          const spellDomnode = spellDomnodes.item(i)
          if (overlapDomnodeSlice(spellDomnode, slice)) {
            return true
          }
        }
      }
    }
  }
} else if (timerepresentation == "timestamp") {
  checkNodeSlice = function(nodeDomnode, slice) {
    let timestamp = nodeDomnode.getAttribute("timestamp")
    if (timestamp) {
      return overlapDomnodeSlice(nodeDomnode, slice)
    } else {
      let spellsDomnodeList = nodeDomnode.getElementsByTagName("spells")
      if (spellsDomnodeList.length>0) {
        let spellsDomnode = spellsDomnodeList.item(0)
        let spellDomnodes = spellsDomnode.getElementsByTagName("spell")
        for (let i=0; i<spellDomnodes.length; i++) {
          const spellDomnode = spellDomnodes.item(i)
          if (overlapDomnodeSlice(spellDomnode, slice)) {
            return true
          }
        }
      }
    }
  }
}
for (let i=0; i<nodeDomnodes.length; i++) {
  if (i>0 && i%100 == 0) {
    logger.info(`${i}/${nodeDomnodes.length} nodes sorted in slices...`)
  }
  const nodeDomnode = nodeDomnodes.item(i)
  slices.forEach(slice => {
    if (checkNodeSlice(nodeDomnode, slice)) {
      let id = nodeDomnode.getAttribute("id")
      let label = nodeDomnode.getAttribute("label")
        // TODO: ATTRIBUTES
      slice.nodes.push({id, label})
    }
  })
}
console.log("slice 0", slices[0])


