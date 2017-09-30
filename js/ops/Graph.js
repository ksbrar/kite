// Copyright 2017, University of Colorado Boulder

/**
 * A multigraph whose edges are segments.
 *
 * @author Jonathan Olson <jonathan.olson@colorado.edu>
 */

define( function( require ) {
  'use strict';

  var arrayRemove = require( 'PHET_CORE/arrayRemove' );
  var Boundary = require( 'KITE/ops/Boundary' );
  var Bounds2 = require( 'DOT/Bounds2' );
  var cleanArray = require( 'PHET_CORE/cleanArray' );
  var Cubic = require( 'KITE/segments/Cubic' );
  var Edge = require( 'KITE/ops/Edge' );
  var Face = require( 'KITE/ops/Face' );
  var inherit = require( 'PHET_CORE/inherit' );
  var kite = require( 'KITE/kite' );
  var Line = require( 'KITE/segments/Line' );
  var Loop = require( 'KITE/ops/Loop' );
  var Matrix3 = require( 'DOT/Matrix3' );
  var Quadratic = require( 'KITE/segments/Quadratic' );
  var Segment = require( 'KITE/segments/Segment' );
  var Subpath = require( 'KITE/util/Subpath' );
  var Transform3 = require( 'DOT/Transform3' );
  var Util = require( 'DOT/Util' );
  var Vertex = require( 'KITE/ops/Vertex' );

  // TODO: Move to common place
  var vertexEpsilon = 1e-5;

  var bridgeId = 0;

  /**
   * @public (kite-internal)
   * @constructor
   */
  function Graph() {
    // @public {Array.<Vertex>}
    this.vertices = [];

    // @public {Array.<Edge>}
    this.edges = [];

    // @public {Array.<Boundary>}
    this.innerBoundaries = [];
    this.outerBoundaries = [];
    this.boundaries = [];

    // @public {Array.<number>}
    this.shapeIds = [];

    // @public {Array.<Loop>}
    this.loops = [];

    // @public {Face}
    this.unboundedFace = Face.createFromPool( null );

    // @public {Array.<Face>}
    this.faces = [ this.unboundedFace ];
  }

  kite.register( 'Graph', Graph );

  inherit( Object, Graph, {

    /**
     * Adds a Shape (with a given ID for CAG purposes) to the graph.
     * @public
     *
     * @param {number} shapeId - The ID which should be shared for all paths/shapes that should be combined with
     *                           respect to the winding number of faces. For CAG, independent shapes should be given
     *                           different IDs (so they have separate winding numbers recorded).
     * @param {Shape} shape
     */
    addShape: function( shapeId, shape ) {
      for ( var i = 0; i < shape.subpaths.length; i++ ) {
        this.addSubpath( shapeId, shape.subpaths[ i ] );
      }
    },

    /**
     * Adds a subpath of a Shape (with a given ID for CAG purposes) to the graph.
     * @public
     *
     * @param {number} shapeId - See addShape() documentation
     * @param {Subpath} subpath
     */
    addSubpath: function( shapeId, subpath ) {
      assert && assert( typeof shapeId === 'number' );
      assert && assert( subpath instanceof Subpath );

      if ( this.shapeIds.indexOf( shapeId ) < 0 ) {
        this.shapeIds.push( shapeId );
      }

      if ( subpath.segments.length === 0 ) {
        return;
      }

      var index;
      var segments = subpath.segments.slice();
      if ( subpath.hasClosingSegment() ) {
        segments.push( subpath.getClosingSegment() );
      }

      var vertices = [];

      for ( index = 0; index < segments.length; index++ ) {
        var previousIndex = index - 1;
        if ( previousIndex < 0 ) {
          previousIndex = segments.length - 1;
        }

        var end = segments[ previousIndex ].end;
        var start = segments[ index ].start;

        if ( start.equals( end ) ) {
          vertices.push( Vertex.createFromPool( start ) );
        }
        else {
          assert && assert( start.distance( end ) < vertexEpsilon, 'Inaccurate start/end points' );
          vertices.push( Vertex.createFromPool( start.average( end ) ) );
        }
      }

      var loop = Loop.createFromPool( shapeId );
      for ( index = 0; index < segments.length; index++ ) {
        var nextIndex = index + 1;
        if ( nextIndex === segments.length ) {
          nextIndex = 0;
        }

        var edge = Edge.createFromPool( segments[ index ], vertices[ index ], vertices[ nextIndex ] );
        loop.halfEdges.push( edge.forwardHalf );
        this.addEdge( edge );
      }

      this.loops.push( loop );
      this.vertices.push.apply( this.vertices, vertices );
    },

    /**
     * Simplifies edges/vertices, computes boundaries and faces (with the winding map).
     * @public
     */
    computeSimplifiedFaces: function() {
      this.eliminateOverlap();
      this.eliminateSelfIntersection();
      this.eliminateIntersection();
      this.collapseVertices();
      this.removeBridges();
      this.removeSingleEdgeVertices();
      this.orderVertexEdges();
      this.extractFaces();
      this.computeBoundaryGraph();
      this.computeWindingMap();
    },

    /**
     * Sets whether each face should be filled or unfilled based on a filter function.
     * @public
     *
     * The windingMapFilter will be called on each face's winding map, and will use the return value as whether the face
     * is filled or not.
     *
     * The winding map is an {Object} associated with each face that has a key for every shapeId that was used in
     * addShape/addSubpath, and the value for those keys is the winding number of the face given all paths with the
     * shapeId.
     *
     * For example, imagine you added two shapeIds (0 and 1), and the iteration is on a face that is included in
     * one loop specified with shapeId:0 (inside a counter-clockwise curve), and is outside of any segments specified
     * by the second loop (shapeId:1). Then the winding map will be:
     * {
     *   0: 1 // shapeId:0 has a winding number of 1 for this face (generally filled)
     *   1: 0 // shapeId:1 has a winding number of 0 for this face (generally not filled)
     * }
     *
     * Generally, winding map filters can be broken down into two steps:
     * 1. Given the winding number for each shapeId, compute whether that loop was originally filled. Normally, this is
     *    done with a non-zero rule (any winding number is filled, except zero). SVG also provides an even-odd rule
     *    (odd numbers are filled, even numbers are unfilled).
     * 2. Given booleans for each shapeId from step 1, compute CAG operations based on boolean formulas. Say you wanted
     *    to take the union of shapeIds 0 and 1, then remove anything in shapeId 2. Given the booleans above, this can
     *    be directly computed as (filled0 || filled1) && !filled2.
     *
     * @param {function} windingMapFilter
     */
    computeFaceInclusion: function( windingMapFilter ) {
      for ( var i = 0; i < this.faces.length; i++ ) {
        var face = this.faces[ i ];
        face.filled = windingMapFilter( face.windingMap );
      }
    },

    /**
     * Create a new Graph object based only on edges in this graph that separate a "filled" face from an "unfilled"
     * face.
     * @public
     *
     * This is a convenient way to "collapse" adjacent filled and unfilled faces together, and compute the curves and
     * holes properly, given a filled "normal" graph.
     */
    createFilledSubGraph: function() {
      var graph = new Graph();

      var vertexMap = {}; // old id => newVertex

      for ( var i = 0; i < this.edges.length; i++ ) {
        var edge = this.edges[ i ];
        if ( edge.forwardHalf.face.filled !== edge.reversedHalf.face.filled ) {
          if ( !vertexMap[ edge.startVertex.id ] ) {
            var newStartVertex = Vertex.createFromPool( edge.startVertex.point );
            graph.vertices.push( newStartVertex );
            vertexMap[ edge.startVertex.id ] = newStartVertex;
          }
          if ( !vertexMap[ edge.endVertex.id ] ) {
            var newEndVertex = Vertex.createFromPool( edge.endVertex.point );
            graph.vertices.push( newEndVertex );
            vertexMap[ edge.endVertex.id ] = newEndVertex;
          }

          var startVertex = vertexMap[ edge.startVertex.id ];
          var endVertex = vertexMap[ edge.endVertex.id ];
          graph.addEdge( Edge.createFromPool( edge.segment, startVertex, endVertex ) );
        }
      }

      graph.collapseAdjacentEdges();
      graph.orderVertexEdges();
      graph.extractFaces();
      graph.computeBoundaryGraph();
      graph.fillAlternatingFaces();

      return graph;
    },

    /**
     * Returns a Shape that creates a subpath for each filled face (with the desired holes).
     * @public
     *
     * Generally should be called on a graph created with createFilledSubGraph().
     *
     * @returns {Shape}
     */
    facesToShape: function() {
      var subpaths = [];
      for ( var i = 0; i < this.faces.length; i++ ) {
        var face = this.faces[ i ];
        if ( face.filled ) {
          subpaths.push( face.boundary.toSubpath() );
          for ( var j = 0; j < face.holes.length; j++ ) {
            subpaths.push( face.holes[ j ].toSubpath() );
          }
        }
      }
      return new kite.Shape( subpaths );
    },

    /**
     * Releases owned objects to their pools, and clears references that may have been picked up from external sources.
     * @public
     */
    dispose: function() {

      // this.boundaries should contain all elements of innerBoundaries and outerBoundaries
      while ( this.boundaries.length ) {
        this.boundaries.pop().dispose();
      }
      cleanArray( this.innerBoundaries );
      cleanArray( this.outerBoundaries );

      while ( this.loops.length ) {
        this.loops.pop().dispose();
      }
      while ( this.faces.length ) {
        this.faces.pop().dispose();
      }
      while ( this.vertices.length ) {
        this.vertices.pop().dispose();
      }
      while ( this.edges.length ) {
        this.edges.pop().dispose();
      }
    },

    /**
     * Adds an edge to the graph (and sets up connection information).
     * @private
     *
     * @param {Edge} edge
     */
    addEdge: function( edge ) {
      assert && assert( edge instanceof Edge );
      assert && assert( !_.includes( edge.startVertex.incidentHalfEdges, edge.reversedHalf ), 'Should not already be connected' );
      assert && assert( !_.includes( edge.endVertex.incidentHalfEdges, edge.forwardHalf ), 'Should not already be connected' );

      this.edges.push( edge );
      edge.startVertex.incidentHalfEdges.push( edge.reversedHalf );
      edge.endVertex.incidentHalfEdges.push( edge.forwardHalf );
    },

    /**
     * Removes an edge from the graph (and disconnects incident information).
     * @private
     *
     * @param {Edge} edge
     */
    removeEdge: function( edge ) {
      assert && assert( edge instanceof Edge );

      arrayRemove( this.edges, edge );
      arrayRemove( edge.startVertex.incidentHalfEdges, edge.reversedHalf );
      arrayRemove( edge.endVertex.incidentHalfEdges, edge.forwardHalf );
    },

    /**
     * Replaces a single edge (in loops) with a series of edges (possibly empty).
     * @private
     *
     * @param {Edge} edge
     * @param {Array.<HalfEdge>} forwardHalfEdges
     */
    replaceEdgeInLoops: function( edge, forwardHalfEdges ) {
      // Compute reversed half-edges
      var reversedHalfEdges = [];
      for ( var i = 0; i < forwardHalfEdges.length; i++ ) {
        reversedHalfEdges.push( forwardHalfEdges[ forwardHalfEdges.length - 1 - i ].getReversed() );
      }

      for ( i = 0; i < this.loops.length; i++ ) {
        var loop = this.loops[ i ];

        for ( var j = loop.halfEdges.length - 1; j >= 0; j-- ) {
          var halfEdge = loop.halfEdges[ j ];

          if ( halfEdge.edge === edge ) {
            var replacementHalfEdges = halfEdge === edge.forwardHalf ? forwardHalfEdges : reversedHalfEdges;
            Array.prototype.splice.apply( loop.halfEdges, [ j, 1 ].concat( replacementHalfEdges ) );
          }
        }
      }
    },

    collapseAdjacentEdges: function() {
      //TODO: Do something like "overlap" analysis for other types?

      var needsLoop = true;
      while ( needsLoop ) {
        needsLoop = false;

        collapsed:
        for ( var i = 0; i < this.vertices.length; i++ ) {
          var vertex = this.vertices[ i ];
          if ( vertex.incidentHalfEdges.length === 2 ) {
            var aEdge = vertex.incidentHalfEdges[ 0 ].edge;
            var bEdge = vertex.incidentHalfEdges[ 1 ].edge;
            var aSegment = aEdge.segment;
            var bSegment = bEdge.segment;
            var aVertex = aEdge.getOtherVertex( vertex );
            var bVertex = bEdge.getOtherVertex( vertex );

            // TODO: handle loops
            assert && assert( this.loops.length === 0 );

            // TODO: Can we avoid this in the inner loop?
            if ( aEdge.startVertex === vertex ) {
              aSegment = aSegment.reversed();
            }
            if ( bEdge.endVertex === vertex ) {
              bSegment = bSegment.reversed();
            }

            if ( aSegment instanceof Line && bSegment instanceof Line ) {
              if ( aSegment.tangentAt( 0 ).normalized().distance( bSegment.tangentAt( 0 ).normalized() ) < 1e-6 ) {
                this.removeEdge( aEdge );
                this.removeEdge( bEdge );
                aEdge.dispose();
                bEdge.dispose();
                arrayRemove( this.vertices, vertex ); // TODO: removeVertex?
                vertex.dispose();

                var newSegment = new Line( aVertex.point, bVertex.point );
                this.addEdge( new Edge( newSegment, aVertex, bVertex ) );

                needsLoop = true;
                break collapsed;
              }
            }
          }
        }
      }
    },

    eliminateOverlap: function() {
      var needsLoop = true;
      while ( needsLoop ) {
        needsLoop = false;

        overlap:
        for ( var i = 0; i < this.edges.length; i++ ) {
          var aEdge = this.edges[ i ];
          var aSegment = aEdge.segment;
          for ( var j = i + 1; j < this.edges.length; j++ ) {
            var bEdge = this.edges[ j ];
            var bSegment = bEdge.segment;

            var overlapFunction = null;
            if ( aSegment instanceof Line && bSegment instanceof Line ) {
              overlapFunction = Line.getOverlaps;
            }
            if ( aSegment instanceof Quadratic && bSegment instanceof Quadratic ) {
              overlapFunction = Quadratic.getOverlaps;
            }
            if ( aSegment instanceof Cubic && bSegment instanceof Cubic ) {
              overlapFunction = Cubic.getOverlaps;
            }

            if ( overlapFunction ) {
              var overlaps = overlapFunction( aSegment, bSegment );
              if ( overlaps.length ) {
                for ( var k = 0; k < overlaps.length; k++ ) {
                  var overlap = overlaps[ k ];
                  if ( Math.abs( overlap.t1 - overlap.t0 ) > 1e-5 &&
                       Math.abs( overlap.qt1 - overlap.qt0 ) > 1e-5 ) {
                    this.splitOverlap( aEdge, bEdge, overlap );

                    needsLoop = true;
                    break overlap;
                  }
                }
              }
            }
          }
        }
      }
      // TODO
    },

    splitOverlap: function( aEdge, bEdge, overlap ) {
      var aSegment = aEdge.segment;
      var bSegment = bEdge.segment;

      // Remove the edges from before
      this.removeEdge( aEdge );
      this.removeEdge( bEdge );

      var t0 = overlap.t0;
      var t1 = overlap.t1;
      var qt0 = overlap.qt0;
      var qt1 = overlap.qt1;

      // Apply rounding so we don't generate really small segments on the ends
      if ( t0 < 1e-5 ) { t0 = 0; }
      if ( t1 > 1 - 1e-5 ) { t1 = 1; }
      if ( qt0 < 1e-5 ) { qt0 = 0; }
      if ( qt1 > 1 - 1e-5 ) { qt1 = 1; }

      var aBefore = t0 > 0 ? aSegment.subdivided( t0 )[ 0 ] : null;
      var bBefore = qt0 > 0 ? bSegment.subdivided( qt0 )[ 0 ] : null;
      var aAfter = t1 < 1 ? aSegment.subdivided( t1 )[ 1 ] : null;
      var bAfter = qt1 < 1 ? bSegment.subdivided( qt1 )[ 1 ] : null;

      var middle = aSegment;
      if ( t0 > 0 ) {
        middle = middle.subdivided( t0 )[ 1 ];
      }
      if ( t1 < 1 ) {
        middle = middle.subdivided( Util.linear( t0, 1, 0, 1, t1 ) )[ 0 ];
      }

      var beforeVertex;
      if ( aBefore && bBefore ) {
        beforeVertex = Vertex.createFromPool( middle.start );
        this.vertices.push( beforeVertex );
      }
      else if ( aBefore ) {
        beforeVertex = overlap.a > 0 ? bEdge.startVertex : bEdge.endVertex;
      }
      else {
        beforeVertex = aEdge.startVertex;
      }

      var afterVertex;
      if ( aAfter && bAfter ) {
        afterVertex = Vertex.createFromPool( middle.end );
        this.vertices.push( afterVertex );
      }
      else if ( aAfter ) {
        afterVertex = overlap.a > 0 ? bEdge.endVertex : bEdge.startVertex;
      }
      else {
        afterVertex = aEdge.endVertex;
      }

      var middleEdge = Edge.createFromPool( middle, beforeVertex, afterVertex );
      this.addEdge( middleEdge );

      var aBeforeEdge;
      var aAfterEdge;
      var bBeforeEdge;
      var bAfterEdge;

      if ( aBefore ) {
        aBeforeEdge = Edge.createFromPool( aBefore, aEdge.startVertex, beforeVertex );
        this.addEdge( aBeforeEdge );
      }
      if ( aAfter ) {
        aAfterEdge = Edge.createFromPool( aAfter, afterVertex, aEdge.endVertex );
        this.addEdge( aAfterEdge );
      }
      if ( bBefore ) {
        bBeforeEdge = Edge.createFromPool( bBefore, bEdge.startVertex, overlap.a > 0 ? beforeVertex : afterVertex );
        this.addEdge( bBeforeEdge );
      }
      if ( bAfter ) {
        bAfterEdge = Edge.createFromPool( bAfter, overlap.a > 0 ? afterVertex : beforeVertex, bEdge.endVertex );
        this.addEdge( bAfterEdge );
      }

      var aEdges = ( aBefore ? [ aBeforeEdge ] : [] ).concat( [ middleEdge ] ).concat( aAfter ? [ aAfterEdge ] : [] );
      var bEdges = ( bBefore ? [ bBeforeEdge ] : [] ).concat( [ middleEdge ] ).concat( bAfter ? [ bAfterEdge ] : [] );

      var aForwardHalfEdges = [];
      var bForwardHalfEdges = [];

      for ( var i = 0; i < aEdges.length; i++ ) {
        aForwardHalfEdges.push( aEdges[ i ].forwardHalf );
      }
      for ( i = 0; i < bEdges.length; i++ ) {
        // Handle reversing the "middle" edge
        var isForward = bEdges[ i ] !== middleEdge || overlap.a > 0;
        bForwardHalfEdges.push( isForward ? bEdges[ i ].forwardHalf : bEdges[ i ].reversedHalf );
      }

      // TODO: remove reversedHalfEdges arrays here, unneeded
      this.replaceEdgeInLoops( aEdge, aForwardHalfEdges );
      this.replaceEdgeInLoops( bEdge, bForwardHalfEdges );

      aEdge.dispose();
      bEdge.dispose();
    },

    eliminateSelfIntersection: function() {
      assert && assert( this.boundaries.length === 0, 'Only handles simpler level primitive splitting right now' );

      for ( var i = this.edges.length - 1; i >= 0; i-- ) {
        var edge = this.edges[ i ];
        var segment = edge.segment;

        if ( segment instanceof Cubic ) {
          // TODO: This might not properly handle when it only one endpoint is
          var selfIntersection = segment.getSelfIntersection();

          if ( selfIntersection ) {
            assert && assert( selfIntersection.aT < selfIntersection.bT );

            var segments = segment.subdivisions( [ selfIntersection.aT, selfIntersection.bT ] );

            var vertex = Vertex.createFromPool( selfIntersection.point );
            this.vertices.push( vertex );

            var startEdge = Edge.createFromPool( segments[ 0 ], edge.startVertex, vertex );
            var middleEdge = Edge.createFromPool( segments[ 1 ], vertex, vertex );
            var endEdge = Edge.createFromPool( segments[ 2 ], vertex, edge.endVertex );

            this.removeEdge( edge );

            this.addEdge( startEdge );
            this.addEdge( middleEdge );
            this.addEdge( endEdge );

            this.replaceEdgeInLoops( edge, [ startEdge.forwardHalf, middleEdge.forwardHalf, endEdge.forwardHalf ] );

            edge.dispose();
          }
        }
      }
    },

    eliminateIntersection: function() {
      // TODO: ideally initially scan to determine potential "intersection" pairs based on bounds overlap
      // TODO: Then iterate (potentially adding pairs when intersections split things) until no pairs exist

      var needsLoop = true;
      while ( needsLoop ) {
        needsLoop = false;

        intersect:
        for ( var i = 0; i < this.edges.length; i++ ) {
          var aEdge = this.edges[ i ];
          var aSegment = aEdge.segment;
          for ( var j = i + 1; j < this.edges.length; j++ ) {
            var bEdge = this.edges[ j ];
            var bSegment = bEdge.segment;

            var intersections = Segment.intersect( aSegment, bSegment );
            intersections = intersections.filter( function( intersection ) {
              // TODO: refactor duplication
              var aT = intersection.aT;
              var bT = intersection.bT;
              // TODO: factor out epsilon
              var aInternal = aT > 1e-5 && aT < ( 1 - 1e-5 );
              var bInternal = bT > 1e-5 && bT < ( 1 - 1e-5 );
              return aInternal || bInternal;
            } );
            if ( intersections.length ) {

              // TODO: In the future, handle multiple intersections (instead of re-running)
              var intersection = intersections[ 0 ];

              // TODO: handle better?
              this.simpleSplit( aEdge, bEdge, intersection.aT, intersection.bT, intersection.point );

              needsLoop = true;
              break intersect;
            }
          }
        }
      }
    },

    simpleSplit: function( aEdge, bEdge, aT, bT, point ) {
      // TODO: factor out epsilon and duplication
      var aInternal = aT > 1e-5 && aT < ( 1 - 1e-5 );
      var bInternal = bT > 1e-5 && bT < ( 1 - 1e-5 );

      var vertex = null;
      if ( !aInternal ) {
        vertex = aT < 0.5 ? aEdge.startVertex : aEdge.endVertex;
      }
      else if ( !bInternal ) {
        vertex = bT < 0.5 ? bEdge.startVertex : bEdge.endVertex;
      }
      else {
        vertex = Vertex.createFromPool( point );
        this.vertices.push( vertex );
      }

      if ( aInternal ) {
        this.splitEdge( aEdge, aT, vertex );
      }
      if ( bInternal ) {
        this.splitEdge( bEdge, bT, vertex );
      }
    },

    splitEdge: function( edge, t, vertex ) {
      assert && assert( this.boundaries.length === 0, 'Only handles simpler level primitive splitting right now' );

      var segments = edge.segment.subdivided( t );
      assert && assert( segments.length === 2 );

      var firstEdge = Edge.createFromPool( segments[ 0 ], edge.startVertex, vertex );
      var secondEdge = Edge.createFromPool( segments[ 1 ], vertex, edge.endVertex );

      // Remove old connections
      this.removeEdge( edge );

      // Add new connections
      this.addEdge( firstEdge );
      this.addEdge( secondEdge );

      this.replaceEdgeInLoops( edge, [ firstEdge.forwardHalf, secondEdge.forwardHalf ] );

      edge.dispose();
    },

    collapseVertices: function() {
      var self = this;
      assert && assert( _.every( this.edges, function( edge ) { return _.includes( self.vertices, edge.startVertex ); } ) );
      assert && assert( _.every( this.edges, function( edge ) { return _.includes( self.vertices, edge.endVertex ); } ) );

      var needsLoop = true;
      while ( needsLoop ) {
        needsLoop = false;
        nextLoop:
        for ( var i = 0; i < this.vertices.length; i++ ) {
          var aVertex = this.vertices[ i ];
          for ( var j = i + 1; j < this.vertices.length; j++ ) {
            var bVertex = this.vertices[ j ];

            var distance = aVertex.point.distance( bVertex.point );
            if ( distance < vertexEpsilon ) {
              var newVertex = Vertex.createFromPool( distance === 0 ? aVertex.point : aVertex.point.average( bVertex.point ) );
              this.vertices.push( newVertex );

              arrayRemove( this.vertices, aVertex );
              arrayRemove( this.vertices, bVertex );
              for ( var k = this.edges.length - 1; k >= 0; k-- ) {
                var edge = this.edges[ k ];
                var startMatches = edge.startVertex === aVertex || edge.startVertex === bVertex;
                var endMatches = edge.endVertex === aVertex || edge.endVertex === bVertex;

                // Outright remove edges that were between A and B.
                if ( startMatches && endMatches ) {
                  this.removeEdge( edge );
                  this.replaceEdgeInLoops( edge, [] ); // remove the edge from loops with no replacement
                  edge.dispose();
                }
                else if ( startMatches ) {
                  edge.startVertex = newVertex;
                  newVertex.incidentHalfEdges.push( edge.reversedHalf );
                  edge.updateReferences();
                }
                else if ( endMatches ) {
                  edge.endVertex = newVertex;
                  newVertex.incidentHalfEdges.push( edge.forwardHalf );
                  edge.updateReferences();
                }
              }

              aVertex.dispose();
              bVertex.dispose();

              needsLoop = true;
              break nextLoop;
            }
          }
        }
      }

      assert && assert( _.every( this.edges, function( edge ) { return _.includes( self.vertices, edge.startVertex ); } ) );
      assert && assert( _.every( this.edges, function( edge ) { return _.includes( self.vertices, edge.endVertex ); } ) );
    },

    /**
     * Scan a given vertex for bridges recursively with a depth-first search.
     * @private
     *
     * Records visit times to each vertex, and back-propagates so that we can efficiently determine if there was another
     * path around to the vertex.
     *
     * Assumes this is only called one time once all edges/vertices are set up. Repeated calls will fail because we
     * don't mark visited/etc. references again on startup
     *
     * See Tarjan's algorithm for more information. Some modifications were needed, since this is technically a
     * multigraph/pseudograph (can have edges that have the same start/end vertex, and can have multiple edges
     * going from the same two vertices).
     *
     * @param {Array.<Edge>} bridges - Appends bridge edges to here.
     * @param {Vertex} vertex
     */
    markBridges: function( bridges, vertex ) {
      vertex.visited = true;
      vertex.visitIndex = vertex.lowIndex = bridgeId++;

      for ( var i = 0; i < vertex.incidentHalfEdges.length; i++ ) {
        var edge = vertex.incidentHalfEdges[ i ].edge;
        var childVertex = vertex.incidentHalfEdges[ i ].startVertex; // by definition, our vertex should be the endVertex
        if ( !childVertex.visited ) {
          edge.visited = true;
          childVertex.parent = vertex;
          this.markBridges( bridges, childVertex );

          // Check if there's another route that reaches back to our vertex from an ancestor
          vertex.lowIndex = Math.min( vertex.lowIndex, childVertex.lowIndex );

          // If there was no route, then we reached a bridge
          if ( childVertex.lowIndex > vertex.visitIndex ) {
            bridges.push( edge );
          }
        }
        else if ( !edge.visited ) {
          vertex.lowIndex = Math.min( vertex.lowIndex, childVertex.visitIndex );
        }
      }
    },

    removeBridges: function() {
      var bridges = [];

      for ( var i = 0; i < this.vertices.length; i++ ) {
        var vertex = this.vertices[ i ];
        if ( !vertex.visited ) {
          this.markBridges( bridges, vertex );
        }
      }

      for ( i = 0; i < bridges.length; i++ ) {
        var bridgeEdge = bridges[ i ];

        this.removeEdge( bridgeEdge );
        this.replaceEdgeInLoops( bridgeEdge, [] );
        bridgeEdge.dispose();
      }
    },

    removeSingleEdgeVertices: function() {
      var self = this;
      assert && assert( _.every( this.edges, function( edge ) { return _.includes( self.vertices, edge.startVertex ); } ) );
      assert && assert( _.every( this.edges, function( edge ) { return _.includes( self.vertices, edge.endVertex ); } ) );
      // TODO: Really need to make sure things are 2-vertex-connected. Look up ways

      var needsLoop = true;
      while ( needsLoop ) {
        needsLoop = false;

        nextVertexLoop:
        for ( var i = this.vertices.length - 1; i >= 0; i-- ) {
          var vertex = this.vertices[ i ];

          if ( vertex.incidentHalfEdges.length < 2 ) {
            // Disconnect any existing edges
            for ( var j = 0; j < vertex.incidentHalfEdges.length; j++ ) {
              var edge = vertex.incidentHalfEdges[ j ].edge;
              this.removeEdge( edge );
              this.replaceEdgeInLoops( edge, [] ); // remove the edge from the loops
              edge.dispose();
            }

            // Remove the vertex
            this.vertices.splice( i, 1 );
            vertex.dispose();

            needsLoop = true;
            break nextVertexLoop;
          }
        }
      }
      assert && assert( _.every( this.edges, function( edge ) { return _.includes( self.vertices, edge.startVertex ); } ) );
      assert && assert( _.every( this.edges, function( edge ) { return _.includes( self.vertices, edge.endVertex ); } ) );
    },

    orderVertexEdges: function() {
      for ( var i = 0; i < this.vertices.length; i++ ) {
        this.vertices[ i ].sortEdges();
      }
    },

    extractFaces: function() {
      var halfEdges = [];
      for ( var i = 0; i < this.edges.length; i++ ) {
        halfEdges.push( this.edges[ i ].forwardHalf );
        halfEdges.push( this.edges[ i ].reversedHalf );
      }

      while ( halfEdges.length ) {
        var boundaryHalfEdges = [];
        var halfEdge = halfEdges[ 0 ];
        var startingHalfEdge = halfEdge;
        while ( halfEdge ) {
          arrayRemove( halfEdges, halfEdge );
          boundaryHalfEdges.push( halfEdge );
          halfEdge = halfEdge.getNext();
          if ( halfEdge === startingHalfEdge ) {
            break;
          }
        }
        var boundary = Boundary.createFromPool( boundaryHalfEdges );
        ( boundary.signedArea > 0 ? this.innerBoundaries : this.outerBoundaries ).push( boundary );
        this.boundaries.push( boundary );
      }

      for ( i = 0; i < this.innerBoundaries.length; i++ ) {
        this.faces.push( Face.createFromPool( this.innerBoundaries[ i ] ) );
      }
    },

    // TODO: detect "indeterminate" for robustness
    computeBoundaryGraph: function() {
      var unboundedHoles = []; // {Array.<Boundary>}

      // TODO: uhhh, pray this angle works and doesnt get indeterminate results?
      var transform = new Transform3( Matrix3.rotation2( 1.5729657 ) );

      for ( var i = 0; i < this.outerBoundaries.length; i++ ) {
        var outerBoundary = this.outerBoundaries[ i ];

        var ray = outerBoundary.computeExtremeRay( transform );

        var closestEdge = null;
        var closestDistance = Number.POSITIVE_INFINITY;
        var closestWind = false;

        for ( var j = 0; j < this.edges.length; j++ ) {
          var edge = this.edges[ j ];

          var intersections = edge.segment.intersection( ray );
          for ( var k = 0; k < intersections.length; k++ ) {
            var intersection = intersections[ k ];

            if ( intersection.distance < closestDistance ) {
              closestEdge = edge;
              closestDistance = intersection.distance;
              closestWind = intersection.wind;
            }
          }
        }

        if ( closestEdge === null ) {
          unboundedHoles.push( outerBoundary );
        }
        else {
          var reversed = closestWind < 0;
          var closestHalfEdge = reversed ? closestEdge.reversedHalf : closestEdge.forwardHalf;
          var closestBoundary = this.getBoundaryOfHalfEdge( closestHalfEdge );
          closestBoundary.childBoundaries.push( outerBoundary );
        }
      }

      unboundedHoles.forEach( this.unboundedFace.recursivelyAddHoles.bind( this.unboundedFace ) );
      for ( i = 0; i < this.faces.length; i++ ) {
        var face = this.faces[ i ];
        if ( face.boundary !== null ) {
          face.boundary.childBoundaries.forEach( face.recursivelyAddHoles.bind( face ) );
        }
      }
    },

    computeWindingMap: function() {
      var edges = this.edges.slice();

      // Winding numbers for "outside" are 0.
      var outsideMap = {};
      for ( var i = 0; i < this.shapeIds.length; i++ ) {
        outsideMap[ this.shapeIds[ i ] ] = 0;
      }
      this.unboundedFace.windingMap = outsideMap;

      while ( edges.length ) {
        for ( var j = edges.length - 1; j >= 0; j-- ) {
          var edge = edges[ j ];

          var forwardHalf = edge.forwardHalf;
          var reversedHalf = edge.reversedHalf;

          var forwardFace = forwardHalf.face;
          var reversedFace = reversedHalf.face;
          assert && assert( forwardFace !== reversedFace );

          var solvedForward = forwardFace.windingMap !== null;
          var solvedReversed = reversedFace.windingMap !== null;

          if ( solvedForward && solvedReversed ) {
            edges.splice( j, 1 );

            if ( assert ) {
              for ( var m = 0; m < this.shapeIds.length; m++ ) {
                var id = this.shapeIds[ m ];
                assert( forwardFace.windingMap[ id ] - reversedFace.windingMap[ id ] === this.computeDifferential( edge, id ) );
              }
            }
          }
          else if ( !solvedForward && !solvedReversed ) {
            continue;
          }
          else {
            var solvedFace = solvedForward ? forwardFace : reversedFace;
            var unsolvedFace = solvedForward ? reversedFace : forwardFace;

            var windingMap = {};
            for ( var k = 0; k < this.shapeIds.length; k++ ) {
              var shapeId = this.shapeIds[ k ];
              var differential = this.computeDifferential( edge, shapeId );
              windingMap[ shapeId ] = solvedFace.windingMap[ shapeId ] + differential * ( solvedForward ? -1 : 1 );
            }
            unsolvedFace.windingMap = windingMap;
          }
        }
      }
    },

    /**
     * Computes the differential in winding numbers (forward face winding number minus the reversed face winding number)
     * ("forward face" is the face on the forward half-edge side, etc.)
     * @private
     *
     * @param {Edge} edge
     * @param {number} shapeId
     * @returns {number} - The difference between forward face and reversed face winding numbers.
     */
    computeDifferential: function( edge, shapeId ) {
      var differential = 0; // forward face - reversed face
      for ( var m = 0; m < this.loops.length; m++ ) {
        var loop = this.loops[ m ];
        if ( loop.shapeId !== shapeId ) {
          continue;
        }

        for ( var n = 0; n < loop.halfEdges.length; n++ ) {
          var loopHalfEdge = loop.halfEdges[ n ];
          if ( loopHalfEdge === edge.forwardHalf ) {
            differential++;
          }
          else if ( loopHalfEdge === edge.reversedHalf ) {
            differential--;
          }
        }
      }
      return differential;
    },

    fillAlternatingFaces: function() {
      var nullFaceFilledCount = 0;
      for ( var i = 0; i < this.faces.length; i++ ) {
        this.faces[ i ].filled = null;
        nullFaceFilledCount++;
      }

      this.unboundedFace.filled = false;
      nullFaceFilledCount--;

      while ( nullFaceFilledCount ) {
        for ( i = 0; i < this.edges.length; i++ ) {
          var edge = this.edges[ i ];
          var forwardFace = edge.forwardHalf.face;
          var reversedFace = edge.reversedHalf.face;

          var forwardNull = forwardFace.filled === null;
          var reversedNull = reversedFace.filled === null;

          if ( forwardNull && !reversedNull ) {
            forwardFace.filled = !reversedFace.filled;
            nullFaceFilledCount--;
          }
          else if ( !forwardNull && reversedNull ) {
            reversedFace.filled = !forwardFace.filled;
            nullFaceFilledCount--;
          }
        }
      }
    },

    getBoundaryOfHalfEdge: function( halfEdge ) {
      for ( var i = 0; i < this.boundaries.length; i++ ) {
        var boundary = this.boundaries[ i ];

        if ( boundary.hasHalfEdge( halfEdge ) ) {
          return boundary;
        }
      }

      throw new Error( 'Could not find boundary' );
    },

    debug: function() {
      var self = this;

      var bounds = Bounds2.NOTHING.copy();
      for ( var i = 0; i < this.edges.length; i++ ) {
        bounds.includeBounds( this.edges[ i ].segment.getBounds() );
      }

      var debugSize = 256;
      var pad = 20;
      var scale = ( debugSize - pad * 2 ) / Math.max( bounds.width, bounds.height );

      function transformContext( context ) {
        context.translate( pad, debugSize - pad );
        context.translate( -bounds.minX, -bounds.minY );
        context.scale( scale, -scale );
      }

      function draw( callback ) {
        var canvas = document.createElement( 'canvas' );
        canvas.width = debugSize;
        canvas.height = debugSize;
        canvas.style.border = '1px solid black';
        var context = canvas.getContext( '2d' );
        transformContext( context );
        callback( context );
        document.body.appendChild( canvas );
      }

      function drawHalfEdges( context, halfEdges, color ) {
        for ( var i = 0; i < halfEdges.length; i++ ) {
          var segment = halfEdges[ i ].getDirectionalSegment();
          context.beginPath();
          context.moveTo( segment.start.x, segment.start.y );
          segment.writeToContext( context );

          var t = 0.8;
          var t2 = 0.83;
          var halfPosition = segment.positionAt( t );
          var morePosition = segment.positionAt( t2 );
          var ext = halfPosition.distance( morePosition ) * 2 / 3;
          var halfTangent = segment.tangentAt( t ).normalized();
          context.moveTo( halfPosition.x - halfTangent.y * ext, halfPosition.y + halfTangent.x * ext );
          context.lineTo( halfPosition.x + halfTangent.y * ext, halfPosition.y - halfTangent.x * ext );
          context.lineTo( morePosition.x, morePosition.y );
          context.closePath();

          context.strokeStyle = color;
          context.lineWidth = 2 / scale;
          context.stroke();
        }
      }

      function drawVertices( context ) {
        for ( var i = 0; i < self.vertices.length; i++ ) {
          context.beginPath();
          context.arc( self.vertices[ i ].point.x, self.vertices[ i ].point.y, 3 / scale, 0, Math.PI * 2, false );
          context.closePath();
          context.fillStyle = 'rgba(0,0,0,0.4)';
          context.fill();
        }
      }

      function drawEdges( context ) {
        for ( var i = 0; i < self.edges.length; i++ ) {
          var edge = self.edges[ i ];
          context.beginPath();
          context.moveTo( edge.segment.start.x, edge.segment.start.y );
          edge.segment.writeToContext( context );
          context.strokeStyle = 'rgba(0,0,0,0.4)';
          context.lineWidth = 2 / scale;
          context.stroke();
        }
      }

      function followBoundary( context, boundary ) {
        var startPoint = boundary.halfEdges[ 0 ].getDirectionalSegment().start;
        context.moveTo( startPoint.x, startPoint.y );
        for ( var i = 0; i < boundary.halfEdges.length; i++ ) {
          var segment = boundary.halfEdges[ i ].getDirectionalSegment();
          segment.writeToContext( context );
        }
        context.closePath();
      }

      function drawFace( context, face, color ) {
        context.beginPath();
        if ( face.boundary === null ) {
          context.moveTo( 1000, 0 );
          context.lineTo( 0, 1000 );
          context.lineTo( -1000, 0 );
          context.lineTo( 0, -1000 );
          context.closePath();
        }
        else {
          followBoundary( context, face.boundary );
        }
        face.holes.forEach( function( boundary ) {
          followBoundary( context, boundary );
        } );
        context.fillStyle = color;
        context.fill();
      }

      draw( function( context ) {
        drawVertices( context );
        drawEdges( context );
      } );

      for ( var j = 0; j < this.loops.length; j++ ) {
        var loop = this.loops[ j ];
        draw( function( context ) {
          drawVertices( context );
          drawHalfEdges( context, loop.halfEdges, 'rgba(0,0,0,0.4)' );
        } );
      }
      for ( j = 0; j < this.innerBoundaries.length; j++ ) {
        var innerBoundary = this.innerBoundaries[ j ];
        draw( function( context ) {
          drawVertices( context );
          drawHalfEdges( context, innerBoundary.halfEdges, 'rgba(0,0,255,0.4)' );
          // var ray = innerBoundary.computeExtremeRay( new Transform3( Matrix3.rotation2( Math.PI * 1.4 ) ) );
          // context.beginPath();
          // context.moveTo( ray.position.x, ray.position.y );
          // context.lineTo( ray.pointAtDistance( 2 ).x, ray.pointAtDistance( 2 ).y );
          // context.strokeStyle = 'rgba(0,255,0,0.4)';
          // context.stroke();
        } );
      }
      for ( j = 0; j < this.outerBoundaries.length; j++ ) {
        var outerBoundary = this.outerBoundaries[ j ];
        draw( function( context ) {
          drawVertices( context );
          drawHalfEdges( context, outerBoundary.halfEdges, 'rgba(255,0,0,0.4)' );
          // var ray = outerBoundary.computeExtremeRay( new Transform3( Matrix3.rotation2( Math.PI * 1.4 ) ) );
          // context.beginPath();
          // context.moveTo( ray.position.x, ray.position.y );
          // context.lineTo( ray.pointAtDistance( 2 ).x, ray.pointAtDistance( 2 ).y );
          // context.strokeStyle = 'rgba(0,255,0,0.4)';
          // context.stroke();
        } );
      }
      for ( j = 0; j < this.faces.length; j++ ) {
        draw( function( context ) {
          drawVertices( context );
          drawEdges( context );
          drawFace( context, self.faces[ j ], 'rgba(0,255,0,0.4)' );
        } );
      }
      for ( var k = 0; k < this.shapeIds.length; k++ ) {
        draw( function( context ) {
          var colorMap = {
            '-3': 'rgba(255,0,0,0.8)',
            '-2': 'rgba(255,0,0,0.4)',
            '-1': 'rgba(127,0,0,0.4)',
            '0': 'rgba(0,0,0,0.4)',
            '1': 'rgba(0,0,127,0.4)',
            '2': 'rgba(0,0,255,0.4)',
            '3': 'rgba(0,0,255,0.8)'
          };
          drawVertices( context );
          drawEdges( context );
          for ( j = 0; j < self.faces.length; j++ ) {
            if ( self.faces[ j ].windingMap ) {
              drawFace( context, self.faces[ j ], colorMap[ self.faces[ j ].windingMap[ self.shapeIds[ k ] ] ] || 'green' );
            }
          }
        } );
      }
      draw( function( context ) {
        drawVertices( context );
        drawEdges( context );
        for ( j = 0; j < self.faces.length; j++ ) {
          if ( self.faces[ j ].filled ) {
            drawFace( context, self.faces[ j ], 'rgba(0,0,0,0.4)' );
          }
        }
      } );
      for ( k = 0; k < this.shapeIds.length; k++ ) {
        draw( function( context ) {
          drawVertices( context );
          drawHalfEdges( context, self.edges.map( function( edge ) { return edge.forwardHalf; } ), 'rgba(0,0,0,0.4)' );
          for ( j = 0; j < self.edges.length; j++ ) {
            var edge = self.edges[ j ];
            var center = edge.segment.start.average( edge.segment.end );
            context.save();
            context.translate( center.x, center.y );
            context.scale( 1, -1 );
            context.font = '2px serif';
            context.textBasline = 'middle';
            context.textAlign = 'center';
            context.fillStyle = 'red';
            context.fillText( '' + self.computeDifferential( edge, self.shapeIds[ k ] ), 0, 0 );
            context.fillStyle = 'blue';
            context.font = '1px serif';
            context.fillText( edge.id, 0, 1 );
            context.restore();
          }
        } );
      }
    }
  } );

  Graph.BINARY_NONZERO_UNION = function( windingMap ) {
    return windingMap[ '0' ] !== 0 || windingMap[ '1' ] !== 0;
  };

  Graph.BINARY_NONZERO_INTERSECTION = function( windingMap ) {
    return windingMap[ '0' ] !== 0 && windingMap[ '1' ] !== 0;
  };

  Graph.BINARY_NONZERO_DIFFERENCE = function( windingMap ) {
    return windingMap[ '0' ] !== 0 && windingMap[ '1' ] === 0;
  };

  Graph.BINARY_NONZERO_XOR = function( windingMap ) {
    return ( ( windingMap[ '0' ] !== 0 ) ^ ( windingMap[ '1' ] !== 0 ) ) === 1;
  };

  Graph.binaryResult = function( shapeA, shapeB, windingMapFilter ) {
    var graph = new Graph();
    graph.addShape( 0, shapeA );
    graph.addShape( 1, shapeB );

    graph.computeSimplifiedFaces();
    graph.computeFaceInclusion( windingMapFilter );
    var subgraph = graph.createFilledSubGraph();
    var shape = subgraph.facesToShape();

    graph.dispose();
    subgraph.dispose();

    return shape;
  };

  return kite.Graph;
} );
