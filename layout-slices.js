import { Command } from 'commander';
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
  .option('--nodesizemin <number>', 'Minimal node size. Default: 10.')
  .option('--nodesizefactor <number>', 'Node size factor: how much node size grows with (in-)degree. Default: 2.')
  .option('--nodesizepower <number>', 'Node size power (exponent): above 1, size grows exponentially with (in-)degree. Default: 1.')
  .option('--strongergravity <boolean>', 'Force Atlas 2 "strong gravity" setting. Default: true')
  .option('--gravity <number>', 'Force Atlas 2 "gravity" setting. Default: 1.')
  .option('--iterationsfactor <number>', 'Force Atlas 2 "iterationsfactor" setting. Default: 10.')
  .option('--barneshut <boolean>', 'Force Atlas 2 "barneshut" setting. Default: true.')
  .option('--scaling <number>', 'Force Atlas 2 "scaling" setting. Default: 1.')
  .option('--linlog <boolean>', 'Force Atlas 2 "linlog" setting. Default: true.')
  .option('--preventoverlap <boolean>', 'Force Atlas 2 "preventoverlap" setting. Default: true.')
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

    let g = buildNetwork(slice)
    logger.info(`Network built (${g.order} nodes, ${g.size} edges).`);

    setNodeSizes(g)

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
  let lastNodesIndex = {}
  data.slices.forEach((slice, i) => {
    if (i>0 && i%100 == 0) {
      logger.info(`Compute layout for slice ${i}/${data.slices.length}...`)
    }

    // Build network
    let g = buildNetwork(slice)
    setNodeSizes(g)

    // Get positions from last time
    g.nodes().forEach(nid => {
      let n = g.getNodeAttributes(nid)
      let last = lastNodesIndex[nid]
      if (last) {
        n.x = last.x
        n.y = last.y
      }
    })

    // Render layout
    renderLayout(g, false)

    // Update node data in slices
    slice.nodes = g.nodes().map(nid => g.getNodeAttributes(nid))

    // Update index
    lastNodesIndex = {}
    g.nodes().forEach(nid => {
      let n = g.getNodeAttributes(nid)
      lastNodesIndex[nid] = {x:n.x, y:n.y}
    })
  })

  // Save data
  const serializedJSON = JSON.stringify(data);
  const outputFile = `slices-layout.json`
  fs.writeFile(outputFile, serializedJSON, (err) => {
    if (err) throw err;
    logger.info(`Slices with layout saved to: ${outputFile}`)
  });
}


/// BUILD NETWORK

function buildNetwork(slice) {
  // Build network
  let g = new Graph({type: "mixed", allowSelfLoops: false})
  slice.nodes.forEach(node => {
    g.addNode(node.id, node)
  })
  slice.edges.forEach(edge => {
    g.addEdge(edge.source, edge.target, edge)
  })
  return g
}


/// SET NODE SIZES

function setNodeSizes(g) {
  // Set node size
  try {
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
}


/// RENDER LAYOUT

function renderLayout(g, sample) {
  // Defaults
  const strongergravity = (options.strongergravity===undefined)?true:(options.strongergravity.toLowerCase()=="true")
  const gravity = +options.gravity || 0.01
  const iterationsfactor = +options.iterationsfactor || 10
  const barneshut = (options.barneshut===undefined)?true:(options.barneshut.toLowerCase()=="true")
  const scaling = +options.scaling || 1
  const linlog = (options.linlog===undefined)?true:options.linlog
  const preventoverlap = (options.preventoverlap===undefined)?true:(options.preventoverlap.toLowerCase()=="true")

  // Steps
  const howManyLayoutSteps = 4 + (preventoverlap?1:0)
  try {
    // Initial positions
    const spreading = Math.sqrt(g.order) * 100
    if (sample) {
      logger.info(`Compute layout 1/${howManyLayoutSteps} - Initial positions...`)
      
      // Applying a random layout before starting
      g.nodes().forEach((nid,i) => {
        g.setNodeAttribute(nid, "x", (Math.random()-0.5)*spreading)
        g.setNodeAttribute(nid, "y", (Math.random()-0.5)*spreading)
      })
    } else {
      let nodesIndex = {}
      g.nodes().forEach(nid => {
        let n = g.getNodeAttributes(nid)
        if (!n.x || !n.y) {
          // The node has no coordinate (it was not there in the previous slice)
          // Compute average of neighbors
          let x = 0
          let y = 0
          let count = 0
          g.forEachNeighbor(nid, (n2id, n2) => {
            if (n2.x && n2.y) {
              x += n2.x
              y += n2.y
              count++
            }
          })
          if (count==0) {
            // No neighbors had positions: we use a random position.
            x = (Math.random()-0.5)*spreading
            y = (Math.random()-0.5)*spreading
          }
          nodesIndex[nid] = {x, y}
        }
      })
      for (let nid in nodesIndex) {
        let n = g.getNodeAttributes(nid)
        n.x = nodesIndex[nid].x
        n.y = nodesIndex[nid].y
      }
    }

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
      strongGravityMode: strongergravity,
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
      strongGravityMode: strongergravity,
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
      strongGravityMode: strongergravity,
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