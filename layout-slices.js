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
    const slice = data.slices[options.sample]

    // Build network
    let g = new Graph({type: "mixed", allowSelfLoops: false})
    slice.nodes.forEach(node => {
      g.addNode(node.id, node)
    })
    slice.edges.forEach(edge => {
      g.addEdge(edge.source, edge.target, edge)
    })
    logger.info(`Network built (${g.order} nodes, ${g.size} edges).`);

    // Set node size
		try {
			const inDegreeMax = Math.max(...g.nodes().map(nid => g.inDegree(nid)))
			const sizeMin = +options.nodesizemin || 10
			const sizeFactor = +options.nodesizefactor || 2
      const sizePower = +options.nodesizepower || 1
			g.nodes().forEach(nid => {
				let n = g.getNodeAttributes(nid)
				n.size = Math.sqrt(sizeMin + sizeFactor * Math.pow(g.inDegree(nid), sizePower))
			})
		} catch (error) {
			logger
        .child({ context: {error:error.message} })
        .error(`An error occurred when setting node sizes`);
      console.log(error)
		}

    // Render layout
    renderLayout(g, true)

    // Export GEXF
    const networkFile = `sampled-slice.gexf`
		let gexfString
		try {
			gexfString = gexf.write(g);
		} catch(error) {
			logger
				.child({ context: {networkFile, error} })
				.error('The network file could not be written into a string');
		}
		try {
			fs.writeFileSync(networkFile, gexfString)
			logger
				.child({ context: {networkFile} })
				.info(`Sampled slice saved successfully as a GEXF file: ${networkFile}`);
		} catch(error) {
			logger
				.child({ context: {networkFile, error} })
				.error('The sampled slice could not be saved as a network file.');
		}
  }
} else {
  // TODO: layout over time
}


/// RENDER LAYOUT

function renderLayout(g, sample) {
  // Defaults
  const gravity = options.layoutgravity || 0.01
  const iterationsfactor = options.iterationsfactor || 10
  const barneshut = (options.barneshut===undefined)?true:options.barneshut
  const scaling = options.scaling || 1
  const linlog = (options.linlog===undefined)?true:options.linlog
  const preventoverlap = (options.preventoverlap===undefined)?true:options.preventoverlap

  // Steps
  const howManyLayoutSteps = 4 + (preventoverlap?1:0)
  try {
    // Initial positions
    if (sample) {
      logger.info(`Compute layout 1/${howManyLayoutSteps} - Initial positions...`)
    }

    // Applying a random layout before starting
    const spreading = Math.sqrt(g.order) * 100
    g.nodes().forEach((nid,i) => {
      g.setNodeAttribute(nid, "x", (Math.random()-0.5)*spreading)
      g.setNodeAttribute(nid, "y", (Math.random()-0.5)*spreading)
    })

    // If the node already existed yesterday, use yesterday's coordinates.
    // TODO
    // g.nodes().forEach((nid,i) => {
    //   const yn = ynIndex[nid]
    //   if (yn) {
    //     g.setNodeAttribute(nid, "x", yn.x)
    //     g.setNodeAttribute(nid, "y", yn.y)
    //   }
    // })

    if (sample) {
      logger.info(`Layout 1/${howManyLayoutSteps} computed.`)
    }

  } catch (error) {
    logger
      .child({ context: {error:error.message} })
      .error(`An error occurred during the layout (1/${howManyLayoutSteps}) of the network`);
    console.log("Error", error)
  }

  try {
    // Rough sketch
    if (sample) {
      logger.info(`Compute layout 2/${howManyLayoutSteps} - Rough sketch...`)
    }

    // Applying FA2 (basis)
    forceAtlas2.assign(g, {iterations: 100*iterationsfactor, settings: {
      linLogMode: linlog,
      outboundAttractionDistribution: false,
      adjustSizes: false,
      edgeWeightInfluence: 0,
      scalingRatio: scaling,
      strongGravityMode: true,
      gravity: gravity,
      slowDown: 5,
      barnesHutOptimize: barneshut,
      barnesHutTheta: 1.2,
    }});

    if (sample) {
      logger.info(`Layout 2/${howManyLayoutSteps} computed.`)
    }

  } catch (error) {
    logger
      .child({ context: {error:error.message} })
      .error(`An error occurred during the layout (2/${howManyLayoutSteps}) of the network`);
    console.log("Error", error)
  }

  try {
    // Refine
    if (sample) {
      logger.info(`Compute layout 3/${howManyLayoutSteps} - Precision pass...`)
    }

    // Refine FA2
    forceAtlas2.assign(g, {iterations: 10*iterationsfactor, settings: {
      linLogMode: linlog,
      outboundAttractionDistribution: false,
      adjustSizes: false,
      edgeWeightInfluence: 0,
      scalingRatio: scaling,
      strongGravityMode: true,
      gravity: gravity,
      slowDown: 20,
      barnesHutOptimize: barneshut,
      barnesHutTheta: 0.3,
    }});

    if (sample) {
      logger.info(`Layout 3/${howManyLayoutSteps} computed.`)
    }

  } catch (error) {
    logger
      .child({ context: {error:error.message} })
      .error(`An error occurred during the layout (3/${howManyLayoutSteps}) of the network`);
    console.log("Error", error)
  }

  try {
    // Refine
    if (sample) {
      logger.info(`Compute layout 4/${howManyLayoutSteps} - Slow refine (no Barnes Hut)...`);
    }

    // Refine FA2
    forceAtlas2.assign(g, {iterations: 2*iterationsfactor, settings: {
      linLogMode: linlog,
      outboundAttractionDistribution: false,
      adjustSizes: false,
      edgeWeightInfluence: 0,
      scalingRatio: scaling,
      strongGravityMode: true,
      gravity: gravity,
      slowDown: 20,
      barnesHutOptimize: false,
      barnesHutTheta: 0.3,
    }});

    if (sample) {
      logger.info(`Layout 4/${howManyLayoutSteps} computed.`)
    }

  } catch (error) {
    logger
      .child({ context: {error:error.message} })
      .error(`An error occurred during the layout (4/${howManyLayoutSteps}) of the network`);
    console.log("Error", error)
  }

  if (preventoverlap) {
    try {
      // Prevent node overlap
      if (sample) {
        logger.info(`Compute layout 5/${howManyLayoutSteps} - Prevent node overlap...`);
      }
  
      noverlap.assign(g, {
        maxIterations: 120*iterationsfactor,
        settings: {
          gridSize: 64,
          margin: 0.9,
          ratio: 1.05,
          speed:8,
        }
      });
      noverlap.assign(g, {
        maxIterations: 80*iterationsfactor,
        settings: {
          gridSize: 64,
          margin: 0.6,
          ratio: 1.05,
          speed:4,
        }
      });
      noverlap.assign(g, {
        maxIterations: 40*iterationsfactor,
        settings: {
          gridSize: 64,
          margin: 0.3,
          ratio: 1.05,
          speed:1,
        }
      });
  
      if (sample) {
        logger.info(`Layout 5/${howManyLayoutSteps} computed.`);
      }
  
    } catch (error) {
      logger
        .child({ context: {error:error.message} })
        .error(`An error occurred during the layout (5/${howManyLayoutSteps}) of the network`);
      console.log("Error", error)
    }
  }
}