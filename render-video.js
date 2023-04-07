import { Command } from 'commander';
import { getLogger } from "./-get-logger.js"
import * as fs from "fs";
import Graph from "graphology";
import { createCanvas, loadImage, ImageData } from "canvas"
import * as d3 from 'd3';

// CLI logic
let program, options
program = new Command();
program
	.name('render-video')
	.description('Render video from slices with layout')
  .option('-i, --input <file>', 'Slices with layout JSON file (default: slices-layout.json)')
  .option('-s, --sample <slice>', 'Samples a single slice as a frame. Use it to tune settings more quickly.')
  .showHelpAfterError()
  .parse(process.argv);

options = program.opts();

// Logger
const logger = getLogger(`log/${program.name()}.log`)
logger.level = "debug"

// Load slices
const slicesFile = options.input || "slices-layout.json"
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

    // Render frame
    let canvas = renderFrame(slice)

    // Save
    const out = fs.createWriteStream('sample-frame.png')
    const stream = canvas.createPNGStream()
    stream.pipe(out)

    logger.info(`Done.`)
  }
} else {
  let lastNodesIndex = {}
  data.slices.forEach((slice, i) => {
    if (i>0 && i%100 == 0) {
      logger.info(`Compute frame for slice ${i}/${data.slices.length}...`)
    }

    // TODO
  })

  // Save data
  const serializedJSON = JSON.stringify(data);
  const outputFile = `slices-layout.json`
  fs.writeFile(outputFile, serializedJSON, (err) => {
    if (err) throw err;
    logger.info(`Slices with layout saved to: ${outputFile}`)
  });
}


/// RENDER FRAME

function renderFrame(slice) {
  // Build network
  let g = new Graph({type: "mixed", allowSelfLoops: false})
  slice.nodes.forEach(node => {
    g.addNode(node.id, node)
  })
  slice.edges.forEach(edge => {
    g.addEdge(edge.source, edge.target, edge)
  })

  let settings = {}

  // Orientation & layout:
  settings.flip_x = false
  settings.flip_y = true
  settings.rotate = 0 // In degrees, clockwise
  settings.margin_top    = 2 // in mm
  settings.margin_right  = 2 // in mm
  settings.margin_bottom = 2 // in mm
  settings.margin_left   = 2 // in mm

  // Image size and resolution
  settings.image_width = 304 // in mm. Default: 200mm (fits in a A4 page)
  settings.image_height = 171
  settings.output_dpi = 320.842 // Dots per inch.
  settings.rendering_dpi = 320.842 // Default: same as output_dpi. You can over- or under-render to tweak quality and speed.

  // Layers:
  // Decide which layers are drawn.
  // The settings for each layer are below.
  settings.draw_background            = true
  settings.draw_hillshading           = false
  settings.draw_edges                 = true
  settings.draw_nodes                 = true
  settings.draw_node_labels           = true

  // Layer: Background
  settings.background_color = "#FFFFFF"

  // Layer: Edges
  settings.max_edge_count = Infinity
  settings.edge_thickness = 0.06 // in mm
  settings.edge_alpha = 1. // Opacity // Range from 0 to 1
  settings.edge_curved = false
  settings.edge_high_quality = true // Halo around nodes // Time-consuming
  settings.edge_color = "#c1c5cd"

  // Layer: Nodes
  settings.adjust_voronoi_range = 100 // Factor // Larger node halo
  settings.node_size = 1. // Factor to adjust the nodes drawing size
  settings.node_color_original = false // Use the original node color
  settings.node_stroke_width = 0.001 // mm
  settings.node_stroke_color = "#FFFFFF"
  settings.node_fill_color = "#8b9ea9"

  // Layer: Node labels
  settings.label_color = "#000000"
  settings.label_color_from_node = false
  settings.label_count = 80
  settings.label_max_length = 42 // Number of characters before truncate. Infinity is a valid value.
  settings.label_font_family = "Raleway"
  settings.label_font_min_size = 7.3 // in pt
  settings.label_font_max_size = 14  // in pt
  settings.label_font_thickness = .001
  settings.label_border_thickness = 0.5 // in mm
  settings.label_spacing_offset = 1.5 // in mm (prevents label overlap)
  settings.label_border_color = settings.edge_color

  // Advanced settings
  settings.voronoi_range = 1.2 // Halo size in mm
  settings.voronoi_resolution_max = 1 * Math.pow(10, 7) // in pixel. 10^7 still quick, 10^8 better quality 
  settings.heatmap_resolution_max = 1 * Math.pow(10, 5) // in pixel. 10^5 quick. 10^7 nice but super slow.
  settings.heatmap_spreading = (settings.image_width - settings.margin_left - settings.margin_right) / 128 // in mm

  // Experimental stuff
  settings.hillshading_strength = 36
  settings.hillshading_color = "#1B2529"
  settings.hillshading_alpha = .36 // Opacity
  settings.hillshading_sun_azimuth = Math.PI * 0.6 // angle in radians
  settings.hillshading_sun_elevation = Math.PI * 0.35 // angle in radians
  settings.hillshading_hypsometric_gradient = true // Elevation gradient color

  /// (END OF SETTINGS)

  let renderer = newRenderer()
  let canvas = renderer.render(g, settings)
  return canvas
}


/// RENDERER

function newRenderer(){

  // NAMESPACE
  var ns = {}

  // Activate when using Node.js
  ns._nodejs = true

  /// Define renderer
  ns.render = function(g, settings) {
    
    ns.init(g, settings)

    // We draw the image layer by layer.
    // Each layer is drawn separately and merged one after another.
    // But the background is its own thing.
    var bgImage = ns.getEmptyLayer(true)
    var layeredImage = ns.getEmptyLayer(true)

    // Draw background
    if (ns.settings.draw_background) {
      bgImage = ns.drawLayerOnTop(bgImage,
        ns.drawBackgroundLayer(ns.settings)
      )
    }

    // Draw Hillshading
    if (ns.settings.draw_hillshading) {
      bgImage = ns.drawLayerOnTop(bgImage,
        ns.drawHillshadingGradient(ns.settings)
      )
    }
    
    // Draw edges
    if (ns.settings.draw_edges) {
      layeredImage = ns.drawLayerOnTop(layeredImage,
        ns.drawEdgesLayer(ns.settings)
      )
    }

    // Draw nodes
    if (ns.settings.draw_nodes) {
      layeredImage = ns.drawLayerOnTop(layeredImage,
        ns.drawNodesLayer(ns.settings)
      )
    }

    // Draw node labels
    if (ns.settings.draw_node_labels) {
      layeredImage = ns.drawLayerOnTop(layeredImage,
        ns.drawNodeLabelsLayer(ns.settings)
      )
    }

    // Merge on background
    layeredImage = ns.overlayLayer(
      bgImage,
      layeredImage,
      "multiply"
    )

    // Build final canvas
    var renderingCanvas = ns.createCanvas()
    renderingCanvas.getContext("2d").putImageData(layeredImage, 0, 0)
    if (ns.settings.output_dpi == ns.settings.rendering_dpi) {
      return renderingCanvas
    }
    var canvas = ns.createCanvas()
    let outputWidth = Math.floor(ns.settings.image_width * ns.settings.output_dpi * 0.0393701)
    let outputHeight = Math.floor(ns.settings.image_height * ns.settings.output_dpi * 0.0393701)
    canvas.width = outputWidth
    canvas.height = outputHeight
    let ctx = canvas.getContext("2d")
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(renderingCanvas, 0, 0, outputWidth, outputHeight);
    return canvas
  }

  /// Initialization
  ns.init = function(g, settings) {
    if (ns._initialized) { return }

    // Default settings
    settings = settings || {}
    settings.image_width = settings.image_width || 150 // in mm. Default: 20mm (fits in a A4 page)
    settings.image_height = settings.image_height || 150
    settings.output_dpi = settings.output_dpi || 300 // Dots per inch. LowRes=72 HighRes=300 PhotoPrint=1440
    settings.rendering_dpi = settings.rendering_dpi || 300 // Default: same as output_dpi. You can over- or under-render to tweak quality and speed.

    // Orientation:
    settings.flip_x = settings.flip_x || false
    settings.flip_y = settings.flip_y || false
    settings.rotate = settings.rotate || 0 // In degrees, clockwise

    // Layers:
    // Decide which layers are drawn.
    // The settings for each layer are below.
    settings.draw_background = (settings.draw_background === undefined)?(true):(settings.draw_background)
    settings.draw_edges = (settings.draw_edges === undefined)?(true):(settings.draw_edges)
    settings.draw_nodes = (settings.draw_nodes === undefined)?(true):(settings.draw_nodes)
    settings.draw_node_labels = (settings.draw_node_labels === undefined)?(true):(settings.draw_node_labels)
    // (end of default settings)

    // Make it sure that the image dimension divides nicely in tiles
    ns.settings = settings

    ns.g = g.copy()

    // Fix missing coordinates and/or colors:
    //  some parts of the script require default values
    //  that are sometimes missing. We add them for consistency.)
    ns.addMissingVisualizationData()

    // For commodity, rescale the network to canvas-related coordinates
    ns.rescaleGraphToGraphicSpace(ns.settings)

    ns._initialized = true
  }




  /// FUNCTIONS

  ns.drawHillshadingGradient = function(options) {
    var options = options || {}
    options.hillshading_alpha = options.hillshading_alpha || .5
    options.hillshading_color = options.hillshading_color || "#000"
    options.hillshading_hypsometric_gradient = options.hillshading_hypsometric_gradient || false

    // Monitoring
    options.display_heatmap = false // for monitoring; hillshade is not diplayed, then.

    var g = ns.g
    var dim = ns.getRenderingPixelDimensions()
    var ctx = ns.createCanvas().getContext("2d")
    ns.scaleContext(ctx)

    /// Unpack heatmap data
    var shadingData = ns.getHillshadingData()
    
    // Unpack heatmap
    var ratio = 1/shadingData.ratio
    var lPixelMap = new Float64Array(dim.w * dim.h)
    var heatmapData, hPixelMap
    if (options.display_heatmap || options.hillshading_hypsometric_gradient) {
      heatmapData = ns.getHeatmapData()
      hPixelMap = new Float64Array(dim.w * dim.h)
    }
    var xu, yu, xp, xp1, xp2, dx, yp, yp1, yp2, dy, ip_top_left, ip_top_right, ip_bottom_left, ip_bottom_right
    for (var i=0; i<lPixelMap.length; i++) {
      // unpacked coordinates
      xu = i%(dim.w)
      yu = (i-xu)/(dim.w)
      // packed coordinates
      xp = xu/ratio
      xp1 = Math.max(0, Math.min(shadingData.width, Math.floor(xp)))
      xp2 = Math.max(0, Math.min(shadingData.width, Math.ceil(xp)))
      dx = (xp-xp1)/(xp2-xp1) || 0
      yp = yu/ratio
      yp1 = Math.max(0, Math.min(shadingData.height, Math.floor(yp)))
      yp2 = Math.max(0, Math.min(shadingData.height, Math.ceil(yp)))
      dy = (yp-yp1)/(yp2-yp1) || 0
      // coordinates of the 4 pixels necessary to rescale
      ip_top_left = xp1 + (shadingData.width+1) * yp1
      ip_top_right = xp2 + (shadingData.width+1) * yp1
      ip_bottom_left = xp1 + (shadingData.width+1) * yp2
      ip_bottom_right = xp2 + (shadingData.width+1) * yp2
      // Rescaling (gradual blending between the 4 pixels)
      lPixelMap[i] =
          (1-dx) * (
            (1-dy) * shadingData.lPixelMap[ip_top_left]
            +  dy  * shadingData.lPixelMap[ip_bottom_left]
          )
        + dx * (
            (1-dy) * shadingData.lPixelMap[ip_top_right]
            +  dy  * shadingData.lPixelMap[ip_bottom_right]
          )
      if (options.display_heatmap || options.hillshading_hypsometric_gradient) {
        hPixelMap[i] =
          (1-dx) * (
              (1-dy) * heatmapData.hPixelMap[ip_top_left]
              +  dy  * heatmapData.hPixelMap[ip_bottom_left]
            )
          + dx * (
              (1-dy) * heatmapData.hPixelMap[ip_top_right]
              +  dy  * heatmapData.hPixelMap[ip_bottom_right]
            )
      }
    }

    if (options.display_heatmap) {
      let hmData = new Uint8ClampedArray(dim.w * dim.h * 4)
      let xOffset = 0
      let yOffset = 0
      hPixelMap.forEach((h,i) => {
        let x = i%(dim.w)
        let y = (i-x)/(dim.w)
        let X = x + xOffset
        let Y = y + yOffset
        if (0 <= X && X <= dim.w && 0 <= Y && Y <= dim.h) {
          let I = X + Y*dim.w
          hmData[4*I  ] = 0
          hmData[4*I+1] = 0
          hmData[4*I+2] = 0
          hmData[4*I+3] = Math.floor(255*(1-h/heatmapData.hMax))
        }
      })
      let hmImgd = new ImageData(hmData, dim.w, dim.h)
      ctx.putImageData(hmImgd,0, 0)
      return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
    } else {
      if (options.hillshading_hypsometric_gradient) {
        let mid_threshold = 0.2
        let colorGradient = d3.scaleLinear()
          .domain([0, mid_threshold*0.8, mid_threshold*1.2, 1])
          .range(['#607395', '#cfd9db', '#ebeeea', '#fefefc'])
          .interpolate(d3.interpolateRgb); //interpolateHsl interpolateHcl interpolateRgb
        let hmData = new Uint8ClampedArray(dim.w * dim.h * 4)
        let xOffset = 0
        let yOffset = 0
        hPixelMap.forEach((h,i) => {
          let x = i%(dim.w)
          let y = (i-x)/(dim.w)
          let X = x + xOffset
          let Y = y + yOffset
          if (0 <= X && X <= dim.w && 0 <= Y && Y <= dim.h) {
            let I = X + Y*dim.w
            let rgb = d3.color(colorGradient((h||0)/heatmapData.hMax))
            hmData[4*I  ] = rgb.r
            hmData[4*I+1] = rgb.g
            hmData[4*I+2] = rgb.b
            hmData[4*I+3] = 255
          }
        })
        let hmImgd = new ImageData(hmData, dim.w, dim.h)
        ctx.putImageData(hmImgd,0, 0)
      }
    
      var lGradient = l => Math.pow(Math.max(0, .2+.8*Math.min(1, 1.4*l||0)), .6)
      var color = d3.color(options.hillshading_color)
      let hsData = new Uint8ClampedArray(dim.w * dim.h * 4)
      let xOffset = 0
      let yOffset = 0
      lPixelMap.forEach((l,i) => {
        let x = i%(dim.w)
        let y = (i-x)/(dim.w)
        let X = x + xOffset
        let Y = y + yOffset
        if (0 <= X && X <= dim.w && 0 <= Y && Y <= dim.h) {
          let I = X + Y*dim.w
          hsData[4*I  ] = color.r
          hsData[4*I+1] = color.g
          hsData[4*I+2] = color.b
          hsData[4*I+3] = Math.floor(255*(1-lGradient(l)))
        }
      })
      let hsImgd = new ImageData(hsData, dim.w, dim.h)
      let imgd = ns.overlayLayer(ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), hsImgd, "multiply")
      ctx.putImageData(imgd,0, 0)
    }

    return ns.multiplyAlpha(
      ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height),
      options.hillshading_alpha
    )
  }

  ns.getHillshadingData = function() {
    // Cache
    if (ns._hillshadingData) {
      return ns._hillshadingData
    }

    var options = {}
    options.elevation_strength = ns.settings.hillshading_strength || 100
    options.hillshading_sun_azimuth = ns.settings.hillshading_sun_azimuth || Math.PI * 1/2
    options.hillshading_sun_elevation = ns.settings.hillshading_sun_elevation || Math.PI * 1/3

    var heatmapData = ns.getHeatmapData()
    // Note: width, height and ratio are always the same as the heatmap
    var width = heatmapData.width
    var height = heatmapData.height
    var ratio = heatmapData.ratio

    // Hillshading formulas from https://observablehq.com/@sahilchinoy/hillshader
    var getSlope = (dzdx, dzdy, z=.2) => Math.atan(z * Math.sqrt(dzdx ** 2 + dzdy ** 2)); // the z factor controls how exaggerated the peaks look
    var getAspect = (dzdx, dzdy) => { return Math.atan2(-dzdy, -dzdx); }
    var getReflectance = function(aspect, slope, sunAzimuth, sunElevation) {
      return Math.cos(Math.PI - aspect - sunAzimuth) * Math.sin(slope) * Math.sin(Math.PI * .5 - sunElevation) + 
        Math.cos(slope) * Math.cos(Math.PI * .5 - sunElevation);
    }
    var hmax = 0
    var lPixelMap = new Float64Array((width+1) * (height+1))
    var hPixelMap = new Float64Array((width+1) * (height+1))
    var dxPixelMap = new Float64Array((width+1) * (height+1))
    var dyPixelMap = new Float64Array((width+1) * (height+1))
    heatmapData.hPixelMap.forEach((h,i) => {
      // We search the indexes of pixels on the left, right, top and bottom.
      // If on border, we use the central pixel instead.
      i = +i
      var x = i%(width+1)
      var y = (i-x)/(width+1)
      var i_left = (i%(width+1) == 0) ? (i) : (i-1)
      var i_right = (i%(width+1) == (width+1) - 1) ? (i) : (i+1)
      var i_top = (i < (width+1)) ? (i) : (i - (width+1))
      var i_bottom = (i > (width+1) * ((height+1) - 1)) ? (i) : (i + (width+1))
      var hleft = heatmapData.hPixelMap[i_left]
      var hright = heatmapData.hPixelMap[i_right]
      var htop = heatmapData.hPixelMap[i_top]
      var hbottom = heatmapData.hPixelMap[i_bottom]
      var dx = hleft - hright
      var dy = htop - hbottom
      var slope = getSlope(dx, dy, options.elevation_strength * Math.sqrt(width * height))
      var aspect = getAspect(dx, dy)
      var L = getReflectance(aspect, slope, options.hillshading_sun_azimuth, options.hillshading_sun_elevation)
      var h = (hleft+hright+htop+hbottom)/4 || 0
      hmax = Math.max(hmax, h)
      hPixelMap[i] = h
      lPixelMap[i] = L
      dxPixelMap[i] = dx
      dyPixelMap[i] = dy
    })
    ns._hillshadingData = {
      lPixelMap: lPixelMap,
      hPixelMap: hPixelMap.map(h => {return h/hmax}),
      dxPixelMap: dxPixelMap,
      dyPixelMap: dyPixelMap,
      width: width,
      height: height,
      ratio: ratio
    }
    return ns._hillshadingData
  }

  ns.getHeatmapData = function() {
    // Cache
    if (ns._heatmapData) {
      return ns._heatmapData
    }

    // Note: here we do not pass specific options, because
    // the method can be called in different drawing contexts
    var options = {}
    options.node_size = 1
    options.resolution_max = ns.settings.heatmap_resolution_max || 1000000 // 1 megapixel.
    options.spread = ns.settings.heatmap_spreading || 1 // in mm
    
    var i, x, y, d, h, ratio, width, height
    var g = ns.g
    // Note we use native dimensions here (not rescaled by tiles)
    // because for the tiles to join perfectly, this must always be
    // computed for the whole set of nodes, i.e. on the untiled image.
    // Performance is managed with a different system (see the ratio below).
    var dim = {
      w: Math.floor(ns.settings.image_width * ns.settings.rendering_dpi * 0.0393701),
      h: Math.floor(ns.settings.image_height * ns.settings.rendering_dpi * 0.0393701)
    }

    // Ratio
    if (dim.w*dim.h>options.resolution_max) {
      ratio = Math.sqrt(options.resolution_max/(dim.w*dim.h))
      width = Math.floor(ratio*dim.w)
      height = Math.floor(ratio*dim.h)
    } else {
      ratio = 1
      width = dim.w
      height = dim.h
    }
    // console.log("Heat map ratio:",ratio,"- Dimensions: "+width+" x "+height)

    // Init a pixel map of floats for heat
    var hPixelMap = new Float64Array((width+1) * (height+1))
    for (i in hPixelMap) {
      hPixelMap[i] = 0
    }

    // Compute the heat using the pixel map
    var spread = options.spread * ratio * ns.settings.rendering_dpi * 0.0393701
    g.nodes().forEach(nid => {
      var n = g.getNodeAttributes(nid)
      var nsize = ratio * n.size * options.node_size
      var nx = ratio * n.x
      var ny = ratio * n.y
      for (x = 0; x <= width; x++ ){
        for (y = 0; y <= height; y++ ){
          i = x + (width+1) * y
          d = Math.sqrt(Math.pow(nx - x, 2) + Math.pow(ny - y, 2))
          d = Math.max(0, d-nsize) // In test
          h = 1 / (1+Math.pow(d/spread, 2))
          hPixelMap[i] = hPixelMap[i] + h
        }
      }
    })

    // Normalize
    hPixelMap = hPixelMap.map(h => h/g.order) // helps consistency across networks
    var hMax = -Infinity
    hPixelMap.forEach(h => {
      hMax = Math.max(h, hMax)
    })
    // Note: we do not actually normalize
    // for the sake of consistency.
    // Indeed, the actual max depends on the resolution,
    // which we do not want. So we keep the raw data
    // as a basis and we only normalize if needed.
    // That's why hMax is exported in the data bundle.
    // hPixelMap = hPixelMap.map(h => h/hMax)

    ns._heatmapData = {
      hPixelMap:hPixelMap,
      hMax: hMax,
      width:width,
      height:height,
      ratio:ratio
    }
    return ns._heatmapData
  }

  ns.overlayLayer = function(backgroundImg, layerImg, mode) {
    var dim = ns.getRenderingPixelDimensions()
    var ctx = ns.createCanvas().getContext("2d")
    ctx.putImageData(backgroundImg, 0, 0)
    ctx.globalCompositeOperation = mode || "hard-light"

    var canvas2 = ns.createCanvas()
    canvas2.getContext("2d").putImageData(layerImg, 0, 0)
    ctx.drawImage(canvas2, 0, 0)

    return ctx.getImageData(0, 0, backgroundImg.width, backgroundImg.height)
  }

  ns.getNormalizeFontSize = function(options) {
    options = options || {}
    options.label_font_thickness = options.label_font_thickness || .3 // In mm

    // Deal with font weights
    //  Relative thicknesses for: Raleway
    var weights =     [ 100, 200, 300, 400, 500, 600, 700, 800, 900 ]
    var thicknesses = [   2, 3.5,   5,   7, 9.5,  12,  15,  18,  21 ]
    var thicknessRatio = 120
    var thicknessToWeight = d3.scaleLinear()
      .domain(thicknesses)
      .range(weights)

    // We restrain the size to the proper steps of the scale
    var text_thickness = ns.mm_to_px(options.label_font_thickness)

    var normalizeFontSize = function(size) {
      // The target thickness is the pen size, which is fixed: text_thickness
      // But to compute the weight, we must know the thickness for a standard size: 1
      var thicknessForFontSize1 = thicknessRatio * text_thickness / size
      var targetWeight = thicknessToWeight(thicknessForFontSize1)
      // console.log(size, thicknessForFontSize1, targetWeight)

      // We need to round to actual weights
      var actualWeight = Math.max(weights[0], Math.min(weights[weights.length-1], 100*Math.round(targetWeight/100)))

      // We can also restrain the size to the actual weight
      var restrainedSize = thicknessRatio * text_thickness / thicknessToWeight.invert(actualWeight)

      return [restrainedSize, actualWeight]
    }

    return normalizeFontSize
  }

  ns.tuneColorForLabel = function(c) {
    var options = {}
    options.label_color_min_C = 0
    options.label_color_max_C = 70
    options.label_color_min_L = 2
    options.label_color_max_L = 50
    var hcl = d3.hcl(c)
    hcl.c = Math.max(hcl.c, options.label_color_min_C)
    hcl.c = Math.min(hcl.c, options.label_color_max_C)
    hcl.l = Math.max(hcl.l, options.label_color_min_L)
    hcl.l = Math.min(hcl.l, options.label_color_max_L)
    return d3.color(hcl)
  }

  ns.drawNodeLabelsLayer = function(options) {
    options = options || {}
    options.label_count = options.label_count || Infinity // Only (try to) display a number of labels
    options.label_max_length = options.label_max_length || Infinity // Max characters (else an ellipsis is used)
    options.colored_labels = (options.colored_labels===undefined)?(true):(options.colored_labels)
    options.label_color = options.label_color || "#000"
    options.label_color_from_node = (options.label_color_from_node===undefined)?(true):(options.label_color_from_node)
    options.sized_labels = (options.sized_labels===undefined)?(true):(options.sized_labels)
    options.node_size = options.node_size || 1 // A scaling factor
    options.label_true_size = options.label_true_size || false // false: size adjusted to the right thickness (weight)
    options.label_spacing_factor = options.label_spacing_factor || 1 // 1=normal; 2=box twice as wide/high etc.
    options.label_spacing_offset = options.label_spacing_offset || 1 // In mm
    options.label_font_family = options.label_font_family || 'Raleway'
    options.label_font_min_size = options.label_font_min_size || 7 // In pt
    options.label_font_max_size = options.label_font_max_size || 14 // In pt
    options.label_font_thickness = options.label_font_thickness || .3 // In mm
    options.label_border_thickness = (options.label_border_thickness===undefined)?(1.):(options.label_border_thickness) // In mm
    options.label_border_color = options.label_border_color || "#FFF"
    options.label_curved_path = (options.label_curved_path===undefined)?(false):(options.label_curved_path)
    options.label_path_step = .5; // In mm
    options.label_path_downhill = true
    options.label_path_center = false
    options.label_path_starting_angle_range = Math.PI/2 // From 0 (horizontal) to PI (any angle)
    options.label_path_step_angle_range = 0.33 // Curvature per font size. 0 is straight.

    var g = ns.g
    var dim = ns.getRenderingPixelDimensions()
    var ctx = ns.createCanvas().getContext("2d")
    ns.scaleContext(ctx)

    var i, x, y

    // Get visible labels
    //var normalizeFontSize = ns.getNormalizeFontSize(options)
    var visibleLabels = ns.getVisibleLabels(options)

    // Draw labels
    var labelsStack = []
    var borderThickness = ns.mm_to_px(options.label_border_thickness)
    var labelPaths = (options.label_curved_path)?(ns.getLabelPaths(options)):(false)
    let drawnMinFontSize = Infinity
    visibleLabels.forEach(function(nid){

      var n = g.getNodeAttributes(nid)
      var nx = n.x
      var ny = n.y

      var color
      if (options.label_color_from_node) {
        color = ns.tuneColorForLabel(ns.getNodeColor(options, n))
      } else {
        color = d3.color(options.label_color)
      }

      // Precompute the label
      ctx.font = ns.buildLabelFontContext(options, n.size)
      var fontSize = +ctx.font.split('px')[0]
      if (!isNaN(fontSize)) {
        drawnMinFontSize = Math.min(drawnMinFontSize, fontSize)
      }

      // Then, draw the label only if wanted
      var radius = Math.max(options.node_size * n.size, 2)
      var labelCoordinates = {
        x: nx,
        y: ny + 0.25 * fontSize
      }

      var label = ns.tuneLabelString(n.label, options)

      // Add to draw pipe
      var l = {
        label: label,
        x: labelCoordinates.x,
        y: labelCoordinates.y,
        path: ((options.label_curved_path)?(labelPaths[nid]):(false)),
        font: ctx.font,
        color: color
      }
      labelsStack.push(l)
    })
    
    ctx.textAlign = "center"
    ctx.lineCap = "round"
    ctx.lineJoin = "round"

    // Draw borders
    if (borderThickness > 0) {
      labelsStack.forEach(function(l){
        ctx.font = l.font
        ctx.lineWidth = borderThickness
        ctx.fillStyle = options.label_border_color
        ctx.strokeStyle = options.label_border_color

        if (options.label_curved_path) {
          ns.drawTextPath(ctx, l.path, l.label, true)
        } else {
          ctx.fillText(
            l.label
          , l.x
          , l.y
          )
          ctx.strokeText(
            l.label
          , l.x
          , l.y
          )
        }
      })
    }

    // Draw text
    labelsStack.forEach(function(l){
      ctx.font = l.font
      ctx.lineWidth = 0
      ctx.fillStyle = l.color.toString()
      if (options.label_curved_path) {
        ns.drawTextPath(ctx, l.path, l.label)
      } else {
        ctx.fillText(
          l.label
        , l.x
        , l.y
        )
      }
    })
    
    // console.log("FONT SIZE MIN (DRAWN) (pt): ", ns.px_to_pt(drawnMinFontSize))
    return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
  }

  ns.getNodeSizeExtent = function() {
    // Cache
    if (ns._nodeSizeExtent) {
      return ns._nodeSizeExtent
    }

    // Compute scale for labels
    var g = ns.g
    var nodeSizeExtent = d3.extent(
      g.nodes().map(function(nid){
        return g.getNodeAttribute(nid, "size")
      })
    )
    if (nodeSizeExtent[0] == nodeSizeExtent[1]) { nodeSizeExtent[0] *= 0.9 }
    ns._nodeSizeExtent = nodeSizeExtent
    return nodeSizeExtent
  }

  ns.buildLabelFontContext = function(options, node_size) {
    var nodeSizeExtent = ns.getNodeSizeExtent()
    var fontSize = ns.pt_to_px( options.sized_labels
      ? Math.floor(options.label_font_min_size + (node_size - nodeSizeExtent[0]) * (options.label_font_max_size - options.label_font_min_size) / (nodeSizeExtent[1] - nodeSizeExtent[0]))
      : Math.floor(0.8 * options.label_font_min_size + 0.2 * options.label_font_max_size)
    )
    
    // sw: Size and weight
    var normalizeFontSize = ns.getNormalizeFontSize(options)
    var sw = normalizeFontSize(fontSize)
    if (!options.true_size) {
      fontSize = sw[0]
    }
    var fontWeight = sw[1]

    return ns.buildContextFontString(fontWeight, fontSize, options.label_font_family)
  }

  ns.getVisibleLabels = function(options) {
    // Cache
    if (ns._visibleLabels) {
      return ns._visibleLabels
    }

    options = options || {}
    options.label_collision_pixmap_max_resolution = options.label_collision_pixmap_max_resolution || 10000000 // 10 megapixel
    options.label_collision_include_node = true
    // For monitoring
    options.download_image = false // For monitoring the process

    var i, x, y, visibleLabels = []
    var dim = ns.getRenderingPixelDimensions()
    var g = ns.g
    var labelPaths = ((options.label_curved_path)?(ns.getLabelPaths(options)):(false))

    // Reverse nodes by size order
    var nodesBySize = ns.getNodesBySize().slice(0)
    nodesBySize.reverse()

    // Ratio
    var ratio, width, height
    if (dim.w*dim.h>options.label_collision_pixmap_max_resolution) {
      ratio = Math.sqrt(options.label_collision_pixmap_max_resolution/(dim.w*dim.h))
      width = Math.floor(ratio*dim.w)
      height = Math.floor(ratio*dim.h)
    } else {
      ratio = 1
      width = dim.w
      height = dim.h
    }
    // console.log("Label collision map ratio:",ratio,"- Dimensions: "+width+" x "+height)

    var ctx = ns.createCanvas().getContext("2d")
    ctx.canvas.width = width
    ctx.canvas.height = height
    ctx.scale(ratio, ratio)
    // Paint all white
    ctx.beginPath()
    ctx.rect(0, 0, dim.w, dim.h)
    ctx.fillStyle = "#000"
    ctx.fill()
    ctx.closePath()

    // Evaluate labels
    var labelDrawCount = options.label_count
    var offset = ns.mm_to_px(options.label_spacing_offset)
    var stroke_width = ns.mm_to_px(options.node_stroke_width || 0)
    var count = 0
    nodesBySize
    .forEach(function(nid){
      var n = g.getNodeAttributes(nid)
      if (labelDrawCount > 0) {
        var nx = n.x
        var ny = n.y

        ctx.font = ns.buildLabelFontContext(options, n.size)
        var fontSize = +ctx.font.replace('bold ', '').split('px')[0]
        var label = ns.tuneLabelString(n.label, options)

        // Create new empty canvas for the bounding area of that label
        var ctx2 = ns.createCanvas().getContext("2d")
        ctx2.canvas.width = width
        ctx2.canvas.height = height
        ctx2.scale(ratio, ratio)
        // Paint all white
        ctx2.beginPath()
        ctx2.rect(0, 0, dim.w, dim.h)
        ctx2.fillStyle = "#000"
        ctx2.fill()
        ctx2.closePath()

        // Draw the bounding area on that canvas
        var path
        if (options.label_curved_path) {
          path = labelPaths[nid]
        } else {
          // Here the path is basically just the dimensions of the label
          var measure = ctx.measureText(label)
          // Assuming centered label
          path = [
            [nx - measure.width/2, ny - 0.25*fontSize],
            [nx + measure.width/2, ny - 0.25*fontSize]
          ]
        }
        if (path.length > 0) {
          var margin = (fontSize * options.label_spacing_factor - fontSize)/2 + offset
          var lineWidth = fontSize + 2*margin
          ctx2.strokeStyle = '#FFF'
          ctx2.lineCap = 'round';
          ctx2.lineJoin = 'round';
          ctx2.lineWidth = lineWidth;
          var pathxmin = dim.w
          var pathxmax = 0
          var pathymin = dim.h
          var pathymax = 0
          ctx2.beginPath()
          var x, y
          x = path[0][0]
          y = path[0][1]
          ctx2.moveTo(x, y)
          pathxmin = Math.min(pathxmin, x)
          pathxmax = Math.max(pathxmax, x)
          pathymin = Math.min(pathymin, y)
          pathymax = Math.max(pathymax, y)
          for (let pi=1; pi<path.length; pi++){
            x = path[pi][0]
            y = path[pi][1]
            ctx2.lineTo(x, y)
            pathxmin = Math.min(pathxmin, x)
            pathxmax = Math.max(pathxmax, x)
            pathymin = Math.min(pathymin, y)
            pathymax = Math.max(pathymax, y)
          }
          ctx2.stroke()

          // Merge with the other canvas
          ctx2.globalCompositeOperation = "multiply"
          ctx2.setTransform(1, 0, 0, 1, 0, 0);
          ctx2.drawImage(ctx.canvas, 0, 0)
          ctx2.scale(ratio, ratio)
  
          // Test bounding box collision
          var collision = false
          var box = {
            x: Math.max(0, pathxmin-lineWidth/2),
            y: Math.max(0, pathymin-lineWidth/2),
            w: Math.min(width , pathxmax-pathxmin + lineWidth),
            h: Math.min(height, pathymax-pathymin + lineWidth)
          }
          if (!isNaN(box.w) && !isNaN(box.h) && box.w>0 && box.h>0) {
            var imgd = ctx2.getImageData(
              Math.floor(ratio*box.x),
              Math.floor(ratio*box.y),
              Math.ceil(ratio*box.w),
              Math.ceil(ratio*box.h)
            )
            var data = imgd.data
            for (let i = 0; i < data.length; i += 4) {
              if (data[i] > 0) {
                collision = true
                break
              }
            }
          } else {
            collision = true
            // console.log("Warning: path issue for "+nid+" ("+label+"):", box)
          }
        } else {
          collision = true
          // console.log("Warning: path of length 0 for "+nid+" ("+label+"):")
        }

        if (!collision) {
          // Draw the bounding area on that canvas
          ctx.strokeStyle = '#FFF'
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = fontSize + 2*margin;
          ctx.beginPath()
          var x, y
          x = path[0][0]
          y = path[0][1]
          ctx.moveTo(x, y)
          for (let pi=1; pi<path.length; pi++){
            x = path[pi][0]
            y = path[pi][1]
            ctx.lineTo(x, y)
          }
          ctx.stroke()

          // Draw the node itself if needed
          if (options.label_collision_include_node) {
            var radius = Math.max(options.node_size * n.size, stroke_width)
            ctx.beginPath()
            ctx.arc(n.x, n.y, radius - 0.5*stroke_width, 0, 2 * Math.PI, false)
            ctx.lineWidth = 0
            ctx.fillStyle = '#FFF'
            ctx.fill()
          }

          // Update count
          labelDrawCount--

          // Add to draw pipe
          visibleLabels.push(nid)

          if (options.download_image) {
            // Draw bounding area rectangle
            ctx.beginPath();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#0FF';
            ctx.rect(box.x, box.y, box.w, box.h)
            ctx.stroke();
  
            // Draw label
            ctx.lineWidth = 0
            ctx.fillStyle = '#F00'
            ctx.textAlign = 'center'
            
            if (options.label_curved_path) {
              ns.drawTextPath(ctx, path, label)
            } else {
              ctx.fillText(
                label,
                nx,
                ny
              )
            }
          }
        }
      }
    })

    if (options.download_image) {
      var imgd = ctx.getImageData(0, 0, width, height)
      ns.downloadImageData(imgd, 'Labels monitoring')
    }
    
    ns._visibleLabels = visibleLabels
    return visibleLabels
  }

  ns.tuneLabelString = function(label, options) {
    options = options || {}
    options.label_max_length = options.label_max_length || Infinity
    return ns.truncateWithEllipsis(label.replace(/^https*:\/\/(www\.)*/gi, ''), options.label_max_length)
  }

  ns.truncateWithEllipsis = function(string, n) {
    if (n && n<Infinity) return string.substr(0,n-1)+(string.length>n?'…':'');
    return string
  }

  ns.buildContextFontString = function(fontWeight, fontSize, fontFamily) {
    // Normalize font size
    fontSize = Math.floor(1000 * fontSize)/1000
    let weightSuffix
    fontWeight = +fontWeight
    switch (fontWeight) {
      case 100:
        weightSuffix = " Thin"
        break
      case 200:
        weightSuffix = " ExtraLight"
        break
      case 300:
        weightSuffix = " Light"
        break
      case 400:
        weightSuffix = ""
        break
      case 500:
        weightSuffix = " Medium"
        break
      case 600:
        weightSuffix = " SemiBold"
        break
      case 700:
        return "bold " + fontSize + "px '" + fontFamily + "', sans-serif"
        break
      case 800:
        weightSuffix = " ExtraBold"
        break
      case 900:
        weightSuffix = " Black"
        break
    }
    return fontSize + "px '" + fontFamily + weightSuffix + "', sans-serif"
  }

  ns.drawEdgesLayer = function(options) {
    var options = options || {}
    options.max_edge_count = (options.max_edge_count === undefined)?(Infinity):(options.max_edge_count) // for monitoring only
    options.edge_thickness = options.edge_thickness || 0.05 // in mm
    options.edge_alpha = (options.edge_alpha===undefined)?(1):(options.edge_alpha) // from 0 to 1
    options.edge_color = options.edge_color || "#303040"
    options.edge_curved = (options.edge_curved===undefined)?(true):(options.edge_curved)
    options.edge_curvature_deviation_angle = options.edge_curvature_deviation_angle || Math.PI / 12 // in radians
    options.edge_high_quality = options.edge_high_quality || false
    options.edge_path_jitter = (options.edge_path_jitter === undefined)?(0.00):(options.edge_path_jitter) // in mm
    options.edge_path_segment_length = options.edge_high_quality?.2:2 // in mm
    // Monitoring options
    options.display_voronoi = false // for monitoring purpose
    options.display_edges = true // disable for monitoring purpose

    var g = ns.g
    var dim = ns.getRenderingPixelDimensions()
    var ctx = ns.createCanvas().getContext("2d")
    ns.scaleContext(ctx)

    var gradient = function(d){
      return Math.round(10000*
        (0.5 + 0.5 * Math.cos(Math.PI - Math.pow(d, 2) * Math.PI))
      )/10000
    }

    var dPixelMap_u, vidPixelMap_u // unpacked versions
    if (options.display_voronoi || options.edge_high_quality) {
      var voronoiData = ns.getVoronoiData()
      
      // Unpack voronoi
      var ratio = 1/voronoiData.ratio
      if (g.order < 255) {
        vidPixelMap_u = new Uint8Array(dim.w * dim.h)
      } else if (g.order < 65535) {
        vidPixelMap_u = new Uint16Array(dim.w * dim.h)
      } else {
        vidPixelMap_u = new Uint32Array(dim.w * dim.h)
      }
      dPixelMap_u = new Uint8Array(dim.w * dim.h)
      var xu, yu, xp, xp1, xp2, dx, yp, yp1, yp2, dy, ip_top_left, ip_top_right, ip_bottom_left, ip_bottom_right
      for (var i=0; i<vidPixelMap_u.length; i++) {
        // unpacked coordinates
        xu = i%(dim.w)
        yu = (i-xu)/(dim.w)
        // packed coordinates
        xp = xu/ratio
        xp1 = Math.max(0, Math.min(voronoiData.width, Math.floor(xp)))
        xp2 = Math.max(0, Math.min(voronoiData.width, Math.ceil(xp)))
        dx = (xp-xp1)/(xp2-xp1) || 0
        yp = yu/ratio
        yp1 = Math.max(0, Math.min(voronoiData.height, Math.floor(yp)))
        yp2 = Math.max(0, Math.min(voronoiData.height, Math.ceil(yp)))
        dy = (yp-yp1)/(yp2-yp1) || 0
        // coordinates of the 4 pixels necessary to rescale
        ip_top_left = xp1 + (voronoiData.width+1) * yp1
        ip_top_right = xp2 + (voronoiData.width+1) * yp1
        ip_bottom_left = xp1 + (voronoiData.width+1) * yp2
        ip_bottom_right = xp2 + (voronoiData.width+1) * yp2
        // Rescaling (gradual blending between the 4 pixels)
        dPixelMap_u[i] =
            (1-dx) * (
              (1-dy) * voronoiData.dPixelMap[ip_top_left]
              +  dy  * voronoiData.dPixelMap[ip_bottom_left]
            )
          + dx * (
              (1-dy) * voronoiData.dPixelMap[ip_top_right]
              +  dy  * voronoiData.dPixelMap[ip_bottom_right]
            )
        // For vid we use only one (it's not a number but an id)
        if (dx<0.5) {
          if (dy<0.5) {
            vidPixelMap_u[i] = voronoiData.vidPixelMap[ip_top_left]
          } else {
            vidPixelMap_u[i] = voronoiData.vidPixelMap[ip_bottom_left]
          }
        } else {
          if (dy<0.5) {
            vidPixelMap_u[i] = voronoiData.vidPixelMap[ip_top_right]
          } else {
            vidPixelMap_u[i] = voronoiData.vidPixelMap[ip_bottom_right]
          }
        }
      }
    }

    if (options.display_voronoi) {
      let vData = new Uint8ClampedArray(dim.w * dim.h * 4)
      let xOffset = 0
      let yOffset = 0
      dPixelMap_u.forEach((d,i) => {
        let x = i%(dim.w)
        let y = (i-x)/(dim.w)
        let X = x + xOffset
        let Y = y + yOffset
        if (0 <= X && X <= dim.w && 0 <= Y && Y <= dim.h) {
          let I = X + Y*dim.w
          vData[4*I  ] = 0
          vData[4*I+1] = 0
          vData[4*I+2] = 0
          vData[4*I+3] = Math.floor(255*gradient(d/255))
        }
      })
      let vImgd = new ImageData(vData, dim.w, dim.h)
      ctx.putImageData(vImgd,0, 0)
    }

    // Draw each edge
    var color = d3.color(options.edge_color)
    var thickness = ns.mm_to_px(options.edge_thickness)
    var jitter = ns.mm_to_px(options.edge_path_jitter)
    var tf = 1
    if (options.display_edges) {
      ctx.lineCap="round"
      ctx.lineJoin="round"
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      g.edges()
        .filter(function(eid, i_){ return i_ < options.max_edge_count })
        .forEach(function(eid, i_){
          if ((i_+1)%10000 == 0) {
            // console.log("..."+(i_+1)/1000+"K edges drawn...")
          }
          var n_s = g.getNodeAttributes(g.source(eid))
          var n_t = g.getNodeAttributes(g.target(eid))
          var path, i, x, y, o, dpixi, lastdpixi, lasto, pixi, pi
          var edgeOpacity = (g.getEdgeAttribute(eid, 'opacity')===undefined)?(1.):(g.getEdgeAttribute(eid, 'opacity'))

          // Build path
          var d = Math.sqrt(Math.pow(n_s.x - n_t.x, 2) + Math.pow(n_s.y - n_t.y, 2))
          var angle = Math.atan2( n_t.y - n_s.y, n_t.x - n_s.x )
          var iPixStep = ns.mm_to_px(options.edge_path_segment_length)
          var segCount = Math.ceil(d/iPixStep)
          pi = 0
          path = new Int32Array(3*segCount)
          if (options.edge_curved) {
            let H = d / (2 * Math.tan(options.edge_curvature_deviation_angle))
            let offset
            for (i=0; i<1; i+=iPixStep/d) {
              offset = H * (Math.sqrt(1 - ( (1-i) * i * Math.pow(d/H,2) )) - 1)
              x = (1-i)*n_s.x + i*n_t.x - offset * Math.sin(angle)
              y = (1-i)*n_s.y + i*n_t.y + offset * Math.cos(angle)

              path[pi  ] = x*tf
              path[pi+1] = y*tf
              path[pi+2] = 255
              pi +=3
            }
          } else {
            for (i=0; i<1; i+=iPixStep/d) {
              x = (1-i)*n_s.x + i*n_t.x
              y = (1-i)*n_s.y + i*n_t.y

              path[pi  ] = x*tf
              path[pi+1] = y*tf
              path[pi+2] = 255
              pi +=3
            }
          }
          path[3*(segCount-1)  ] = n_t.x*tf
          path[3*(segCount-1)+1] = n_t.y*tf
          path[3*(segCount-1)+2] = 255

          // Compute path opacity
          if (options.edge_high_quality) {
            lastdpixi = undefined
            for (pi=0; pi<path.length; pi+=3) {
              x = path[pi  ] / tf
              y = path[pi+1] / tf

              // Opacity
              pixi = Math.floor(x*tf) + dim.w * tf * Math.floor(y*tf)
              dpixi = dPixelMap_u[pixi]
              if (dpixi === undefined) {
                if (lastdpixi !== undefined) {
                  o = lasto
                } else {
                  o = 0
                }
              } else {
                if (vidPixelMap_u[pixi] == n_s.vid || vidPixelMap_u[pixi] == n_t.vid) {
                  o = 1
                } else {
                  o = gradient(dpixi/255)
                }
                if (lastdpixi === undefined && pi>3) {
                  path[(pi-3)+2] = Math.round(o*255)
                }
              }
              path[pi+2] = Math.round(o*255)
              lastdpixi = dpixi
              lasto = o
            }

            // Smoothe path opacity
            if (path.length > 5) {
              for (i=2; i<path.length/3-2; i++) {
                path[i*3+2] = 0.15 * path[(i-2)*3+2] + 0.25 * path[(i-1)*3+2] + 0.2 * path[i*3+2] + 0.25 * path[(i+1)*3+2] + 0.15 * path[(i+2)*3+2]
              }
            }
          }
          
          // Draw path
          var x, y, o, lastx, lasty, lasto
          for (i=0; i<path.length; i+=3) {
            x = Math.floor( 1000 * (path[i]/tf + jitter * (0.5 - Math.random())) ) / 1000
            y = Math.floor( 1000 * (path[i+1]/tf + jitter * (0.5 - Math.random())) ) / 1000
            o = path[i+2]/255

            if (lastx) {
              ctx.lineWidth = thickness * (0.9 + 0.2*Math.random())
              color.opacity = edgeOpacity*(lasto+o)/2
              ctx.beginPath()
              ctx.strokeStyle = color.toString()
              ctx.moveTo(lastx, lasty)
              ctx.lineTo(x, y)
              ctx.stroke()
              ctx.closePath()
            }

            lastx = x
            lasty = y
            lasto = o
          }
        })
    }

    return ns.multiplyAlpha(
      ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height),
      options.edge_alpha
    )
  }

  ns.getNodesBySize = function() {
    // Cache
    if (ns._nodesBySize) {
      return ns._nodesBySize
    }

    var g = ns.g

    // Order nodes by size to draw with the right priority
    var nodesBySize = g.nodes().slice(0)
    // We sort nodes by 1) size and 2) left to right
    nodesBySize.sort(function(naid, nbid){
      var na = g.getNodeAttributes(naid)
      var nb = g.getNodeAttributes(nbid)
      
      if ( na.size < nb.size ) {
        return 1
      } else if ( na.size > nb.size ) {
        return -1
      } else if ( na.x < nb.x ) {
        return 1
      } else if ( na.x > nb.x ) {
        return -1
      }
      return 0
    })
    nodesBySize.reverse() // Because we draw from background to foreground
    ns._nodesBySize = nodesBySize

    return nodesBySize
  }

  ns.getVoronoiData = function() {
    // Cache
    if (ns._voronoiData) {
      return ns._voronoiData
    }

    var i, x, y, d, ratio, width, height
    var g = ns.g
    // Note we use native dimensions for the voronoï (not rescaled by tiles)
    // because for the tiles to join perfectly, the voronoï must always be
    // computed for the whole set of nodes, i.e. on the untiled image.
    // Performance is managed with a different system (see the ratio below).
    var dim = {
      w: Math.floor(ns.settings.image_width * ns.settings.rendering_dpi * 0.0393701),
      h: Math.floor(ns.settings.image_height * ns.settings.rendering_dpi * 0.0393701)
    }

    // Note: here we do not pass specific options, because
    // the method can be called in different drawing contexts
    var options = {}
    options.node_size = 1
    options.voronoi_resolution_max = ns.settings.voronoi_resolution_max || 100000000 // 100 megapixel.
    options.voronoi_range = ns.settings.voronoi_range * ns.settings.rendering_dpi * 0.0393701
    
    // Ratio
    if (dim.w*dim.h>options.voronoi_resolution_max) {
      ratio = Math.sqrt(options.voronoi_resolution_max/(dim.w*dim.h))
      width = Math.floor(ratio*dim.w)
      height = Math.floor(ratio*dim.h)
    } else {
      ratio = 1
      width = dim.w
      height = dim.h
    }
    // console.log("Voronoï ratio:",ratio,"- Dimensions: "+width+" x "+height)

    // Get an index of nodes where ids are integers
    var nodesIndex = g.nodes().slice(0)
    nodesIndex.unshift(null) // We reserve 0 for "no closest"

    // Save this "voronoi id" as a node attribute
    nodesIndex.forEach(function(nid, vid){
      if (vid > 0) {
        var n = g.getNodeAttributes(nid)
        n.vid = vid
      }
    })

    // Init a pixel map of integers for voronoi ids
    var vidPixelMap
    if (g.order < 255) {
      vidPixelMap = new Uint8Array((width+1) * (height+1))
    } else if (g.order < 65535) {
      vidPixelMap = new Uint16Array((width+1) * (height+1))
    } else {
      vidPixelMap = new Uint32Array((width+1) * (height+1))
    }
    for (i in vidPixelMap) {
      vidPixelMap[i] = 0
    }

    // Init a pixel map of floats for distances
    var dPixelMap = new Uint8Array((width+1) * (height+1))
    for (i in dPixelMap) {
      dPixelMap[i] = 255
    }

    // Compute the voronoi using the pixel map
    g.nodes().forEach(nid => {
      var n = g.getNodeAttributes(nid)
      var nsize = ratio * n.size * options.node_size
      var nx = ratio * n.x
      var ny = ratio * n.y
      var range = nsize + options.voronoi_range * ratio
      for (x = Math.max(0, Math.floor(nx - range) ); x <= Math.min(width, Math.floor(nx + range) ); x++ ){
        for (y = Math.max(0, Math.floor(ny - range) ); y <= Math.min(height, Math.floor(ny + range) ); y++ ){
          d = Math.sqrt(Math.pow(nx - x, 2) + Math.pow(ny - y, 2))
    
          if (d < range) {
            var dmod // A tweak of the voronoi: a modified distance in [0,1]
            if (d <= nsize) {
              // "Inside" the node
              dmod = 0
            } else {
              // In the halo range
              dmod = (d - nsize) / (options.voronoi_range  * ratio)
            }
            i = x + (width+1) * y
            var existingVid = vidPixelMap[i]
            if (existingVid == 0) {
              // 0 means there is no closest node
              vidPixelMap[i] = n.vid
              dPixelMap[i] = Math.floor(dmod*255)
            } else {
              // There is already a closest node. Edit only if we are closer.
              if (dmod*255 < dPixelMap[i]) {
                vidPixelMap[i] = n.vid
                dPixelMap[i] = Math.floor(dmod*255)
              }
            }
          }
        }
      }
    })

    ns._voronoiData = {
      nodesIndex: nodesIndex,
      vidPixelMap: vidPixelMap,
      dPixelMap:dPixelMap,
      width:width,
      height:height,
      ratio:ratio
    }
    return ns._voronoiData
  }

  ns.getNodeColor = function(options, n) {
    options = options || {}
    
    if (options.node_color_original) {
      return n.color || options.node_fill_color
    } else {
      return options.node_fill_color
    }
  }

  ns.drawNodesLayer = function(options) {
    options = options || {}
    options.node_size = options.node_size || 1
    options.node_stroke = (options.node_stroke===undefined)?(true):(options.node_stroke)
    options.node_stroke_width = options.node_stroke_width || 0.08 // in mm
    options.node_color_original = (options.node_color_original===undefined)?(false):(options.node_color_original)
    options.node_color_by_modalities = (options.node_color_by_modalities===undefined)?(false):(options.node_color_by_modalities)
    options.node_fill_color = options.node_fill_color || "#FFF"
    options.node_stroke_color = options.node_stroke_color || "#303040"

    var g = ns.g
    var ctx = ns.createCanvas().getContext("2d")
    ns.scaleContext(ctx)

    // Node dots
    var stroke_width = ns.mm_to_px(options.node_stroke_width)

    ns.getNodesBySize().forEach(function(nid){
      var n = g.getNodeAttributes(nid)
      var color = ns.getNodeColor(options, n)
      var radius = Math.max(options.node_size * n.size, stroke_width)

      ctx.lineCap="round"
      ctx.lineJoin="round"

      if (options.node_stroke) {
        // The node stroke is in fact a bigger full circle drawn behind
        ctx.beginPath()
        ctx.arc(n.x, n.y, radius + 0.5*stroke_width, 0, 2 * Math.PI, false)
        ctx.lineWidth = 0
        ctx.fillStyle = options.node_stroke_color
        ctx.shadowColor = 'transparent'
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(n.x, n.y, radius - 0.5*stroke_width, 0, 2 * Math.PI, false)
      ctx.lineWidth = 0
      ctx.fillStyle = color.toString()
      ctx.shadowColor = 'transparent'
      ctx.fill()

    })

    return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
  }

  ns.paintAll = function(ctx, color) {
    ctx.beginPath()
    ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.fillStyle = color
    ctx.fill()
    ctx.closePath()
  }

  ns.multiplyAlpha = function(imgd, alpha) {
    var w = imgd.width
    var h = imgd.height
    var pix = imgd.data
    
    // output
    var co = ns.createCanvas()
    co.width = w
    co.height = h
    var imgdo = co.getContext("2d").createImageData(w,h)
    var pixo = imgdo.data

    for ( var i = 0, pixlen = pixo.length; i < pixlen; i += 4 ) {
      pixo[i+0] = pix[i+0]
      pixo[i+1] = pix[i+1]
      pixo[i+2] = pix[i+2]
      pixo[i+3] = Math.floor(alpha * pix[i+3])
    }

    return imgdo
  }

  ns.drawBackgroundLayer = function(options) {

    options = options || {}
    options.background_color = options.background_color || "#FFF"

    var ctx = ns.createCanvas().getContext("2d")
    ns.paintAll(ctx, options.background_color)
    return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
  }

  ns.drawLayerOnTop = function(bottomLayer, topLayer) {

    // New Canvas
    var newCanvas = ns.createCanvas()
    newCanvas.width = bottomLayer.width
    newCanvas.height = bottomLayer.height
    var ctx = newCanvas.getContext("2d")

    // Paint bottom layer
    ctx.putImageData(bottomLayer, 0, 0)

    // Create temporary canvas for top layer
    var canvas2=ns.createCanvas()
    canvas2.width=topLayer.width
    canvas2.height=topLayer.height
    var ctx2=canvas2.getContext("2d")
    ctx2.putImageData(topLayer, 0, 0)

    ctx.drawImage(canvas2,0,0);

    return ctx.getImageData(0, 0, bottomLayer.width, bottomLayer.height)
  }

  ns.getEmptyLayer = function(paintWhite) {
    let dim = ns.getRenderingPixelDimensions()
    let canvas = ns.createCanvas()
    let ctx = canvas.getContext("2d")
    if (paintWhite) {
      ns.paintAll(ctx, "#FFFFFF")
    }
    return ctx.getImageData(0, 0, dim.w, dim.h)
  }

  ns.createCanvas = function() {
    let dim = ns.getRenderingPixelDimensions()
    let canvas
    if (ns._nodejs) {
      canvas = createCanvas(dim.w, dim.h) // Node version
    } else {
      canvas = document.createElement('canvas')
    }
    canvas.width = dim.w
    canvas.height = dim.h
    return canvas
  }

  ns.scaleContext = function(ctx) {
    // Do nothing (no tiles)
  }

  ns.getRenderingPixelDimensions = function() {
    let width = Math.floor(ns.mm_to_px(ns.settings.image_width))
    let height = Math.floor(ns.mm_to_px(ns.settings.image_height))
    return {w:width, h:height}
  }

  ns.addMissingVisualizationData = function() {
    var colorIssues = 0
    var coordinateIssues = 0
    var g = ns.g
    g.nodes().forEach(function(nid){
      var n = g.getNodeAttributes(nid)
      if (!isNumeric(n.x) || !isNumeric(n.y)) {
        var c = getRandomCoordinates()
        n.x = c[0]
        n.y = c[1]
        coordinateIssues++
      }
      if (!isNumeric(n.size)) {
        n.size = 1
      }
      if (n.color == undefined) {
        n.color = '#665'
        colorIssues++
      }
      if (n.label == undefined) {
        n.label = ''
      }
    })

    if (coordinateIssues > 0) {
      alert('Note: '+coordinateIssues+' nodes had coordinate issues. We carelessly fixed them.')
    }

    function isNumeric(n) {
      return !isNaN(parseFloat(n)) && isFinite(n)
    }
    
    function getRandomCoordinates() {
      var candidates
      var d2 = Infinity
      while (d2 > 1) {
        candidates = [2 * Math.random() - 1, 2 * Math.random() - 1]
        d2 = candidates[0] * candidates[0] + candidates[1] * candidates[1]
      }
      var heuristicRatio = 5 * Math.sqrt(g.order)
      return candidates.map(function(d){return d * heuristicRatio})
    }
  }

  ns.rescaleGraphToGraphicSpace = function(options) {
    options = options || {}
    options.flip_x = options.flip_x || false
    options.flip_y = options.flip_y || false
    options.rotate = options.rotate || 0
    options.use_barycenter_ratio = options.use_barycenter_ratio || .2 // Between 0 (center for borders) and 1 (center for mass)
    options.contain_in_inscribed_circle = options.contain_in_inscribed_circle || false
    options.margin_bottom = (options.margin_bottom === undefined)?( 6):(options.margin_bottom) // in mm, space for the text etc.
    options.margin_right  = (options.margin_right  === undefined)?( 6):(options.margin_right ) // in mm, space for the text etc.
    options.margin_left   = (options.margin_left   === undefined)?( 6):(options.margin_left  ) // in mm, space for the text etc.
    options.margin_top    = (options.margin_top    === undefined)?( 6):(options.margin_top   ) // in mm, space for the text etc.

    var g = ns.g
    let dim = ns.getRenderingPixelDimensions()
    let m = {
      t: ns.mm_to_px(options.margin_top),
      r: ns.mm_to_px(options.margin_right),
      b: ns.mm_to_px(options.margin_bottom),
      l: ns.mm_to_px(options.margin_left)
    }

    // Flip
    if (options.flip_x) {
      g.nodes().forEach(function(nid){
        var n = g.getNodeAttributes(nid)
        n.x = -n.x
      })
    }
    if (options.flip_y) {
      g.nodes().forEach(function(nid){
        var n = g.getNodeAttributes(nid)
        n.y = -n.y
      })
    }

    // Rotate
    function cartesian2Polar(x, y){
      let dist = Math.sqrt(x*x + y*y)
      let radians = Math.atan2(y,x) //This takes y first
      let polarCoor = { dist:dist, radians:radians }
      return polarCoor
    }
    if (options.rotate != 0) {
      let theta = Math.PI * options.rotate / 180
      g.nodes().forEach(function(nid){
        var n = g.getNodeAttributes(nid)
        let pol = cartesian2Polar(n.x,n.y)
        let d = pol.dist
        let angle = pol.radians + theta
        n.x = d * Math.cos(angle)
        n.y = d * Math.sin(angle)
      })
    }

    var ratio
    var xcenter
    var ycenter

    // Barycenter resize
    var xbarycenter = 0
    var ybarycenter = 0
    var wtotal = 0
    var dx
    var dy

    g.nodes().forEach(function(nid){
      var n = g.getNodeAttributes(nid)
      // We use node size as weight (default to 1)
      n.size = n.size || 1
      xbarycenter += n.size * n.x
      ybarycenter += n.size * n.y
      wtotal += n.size
    })
    xbarycenter /= wtotal
    ybarycenter /= wtotal

    // Geometric center
    let xext = d3.extent(g.nodes(), nid => g.getNodeAttribute(nid, 'x'))
    let yext = d3.extent(g.nodes(), nid => g.getNodeAttribute(nid, 'y'))
    var xgeocenter = (xext[0] + xext[1]) / 2
    var ygeocenter = (yext[0] + yext[1]) / 2

    // Compromise
    xcenter = options.use_barycenter_ratio * xbarycenter + (1-options.use_barycenter_ratio) * xgeocenter
    ycenter = options.use_barycenter_ratio * ybarycenter + (1-options.use_barycenter_ratio) * ygeocenter

    if (options.contain_in_inscribed_circle) {
      var dmax = 0 // Maximal distance from center
      g.nodes().forEach(function(nid){
        var n = g.getNodeAttributes(nid)
        var d = Math.sqrt( Math.pow(n.x - xcenter - n.size, 2) + Math.pow(n.y - ycenter - n.size, 2) )
        dmax = Math.max(dmax, d)
      })

      ratio = ( Math.min(dim.w-m.r-m.l, dim.h-m.t-m.b) ) / (2 * dmax)
      // console.log("Rescale ratio: "+ratio)
    } else {
      var dxmax = 0
      var dymax = 0
      g.nodes().forEach(function(nid){
        var n = g.getNodeAttributes(nid)
        var dx = Math.abs(n.x - xcenter - n.size)
        var dy = Math.abs(n.y - ycenter - n.size)
        dxmax = Math.max(dxmax, dx)
        dymax = Math.max(dymax, dy)
      })
      ratio = Math.min((dim.w-m.r-m.l)/(2 * dxmax), (dim.h-m.t-m.b)/(2 * dymax))
      // console.log("Rescale ratio: "+ratio)
    }

    // Resize
    g.nodes().forEach(function(nid){
      var n = g.getNodeAttributes(nid)
      n.x = m.l + (dim.w-m.r-m.l) / 2 + (n.x - xcenter) * ratio
      n.y = m.t + (dim.h-m.t-m.b) / 2 + (n.y - ycenter) * ratio
      n.size *= ratio
    })
  }

  ns.mm_to_px = function(d) {
    return d * ns.settings.rendering_dpi * 0.0393701
  }

  ns.pt_to_px = function(d) {
    return Math.round(1000 * d * ns.settings.rendering_dpi / ( 72 )) / 1000
  }

  ns.px_to_pt = function(d) {
    return Math.round(1000 * d * ( 72 ) / ns.settings.rendering_dpi) / 1000
  }

  return ns
}