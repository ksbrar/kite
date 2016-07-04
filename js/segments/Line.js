// Copyright 2013-2015, University of Colorado Boulder

/**
 * Linear segment
 *
 * @author Jonathan Olson <jonathan.olson@colorado.edu>
 */

define( function( require ) {
  'use strict';

  var inherit = require( 'PHET_CORE/inherit' );
  var Bounds2 = require( 'DOT/Bounds2' );
  var Vector2 = require( 'DOT/Vector2' );
  var Util = require( 'DOT/Util' );

  var kite = require( 'KITE/kite' );
  var Segment = require( 'KITE/segments/Segment' );

  var scratchVector2 = new Vector2();

  /**
   *
   * @param {Vector2} start
   * @param {Vector2} end
   * @constructor
   */
  function Line( start, end ) {
    Segment.call( this );

    this._start = start; // @private {Vector2}
    this._end = end; // @private  {Vector2}

    this.invalidate();
  }

  kite.register( 'Line', Line );

  inherit( Segment, Line, {

    /**
     * Clears cached information, should be called when any of the 'constructor arguments' are mutated.
     * @public
     */
    invalidate: function() {
      // Lazily-computed derived information
      this._tangent = null; // {Vector2 | null}
      this._bounds = null; // {Bounds2 | null}

      this.trigger0( 'invalidated' );
    },

    /**
     * Returns a normalized unit vector that is tangent to this line (at the starting point)
     * the unit vectors points toward the end points.
     * @returns {Vector2}
     */
    getStartTangent: function() {
      if ( this._tangent === null ) {
        // TODO: allocation reduction
        this._tangent = this._end.minus( this._start ).normalized();
      }
      return this._tangent;
    },
    get startTangent() { return this.getStartTangent(); },

    /**
     * Returns the normalized unit vector that is tangent to this line
     * same as getStartTangent, since this is a straight line
     * @returns {Vector2}
     */
    getEndTangent: function() {
      return this.getStartTangent();
    },
    get endTangent() { return this.getEndTangent(); },

    /**
     * Gets the bounds of this line
     * @returns {Bounds2}
     */
    getBounds: function() {
      // TODO: allocation reduction
      if ( this._bounds === null ) {
        this._bounds = Bounds2.NOTHING.copy().addPoint( this._start ).addPoint( this._end );
      }
      return this._bounds;
    },
    get bounds() { return this.getBounds(); },

    /**
     * Returns the bounding box for this transformed Line
     * @param {Matrix3} matrix
     * @returns {Bounds2}
     */
    getBoundsWithTransform: function( matrix ) {
      // uses mutable calls
      var bounds = Bounds2.NOTHING.copy();
      bounds.addPoint( matrix.multiplyVector2( scratchVector2.set( this._start ) ) );
      bounds.addPoint( matrix.multiplyVector2( scratchVector2.set( this._end ) ) );
      return bounds;
    },

    /**
     * Returns the non degenerate segments of ths line
     * Unless it is of zero length, it will returns this line in an array.
     * @returns {Array.<Line>|[]}
     */
    getNondegenerateSegments: function() {
      // if it is degenerate (0-length), just ignore it
      if ( this._start.equals( this._end ) ) {
        return [];
      }
      else {
        return [ this ];
      }
    },

    /**
     * Returns the position parametrically, with 0 <= t <= 1.
     * @param {number} t
     * @returns {Vector2}
     */
    positionAt: function( t ) {
      return this._start.plus( this._end.minus( this._start ).times( t ) );
    },

    /**
     * Returns the non-normalized tangent (dx/dt, dy/dt) parametrically, with 0 <= t <= 1.
     * For a line, the tangent is independent of t
     * @param {number} t
     * @returns {Vector2}
     */
    tangentAt: function( t ) {
      // tangent always the same, just use the start tangent
      return this.getStartTangent();
    },

    /**
     * Returns the signed curvature (positive for visual clockwise - mathematical counterclockwise) of this Line
     * Since a line is straight, it returns zero
     * @param {number} t
     * @returns {number}
     */
    curvatureAt: function( t ) {
      return 0; // no curvature on a straight line segment
    },

    /**
     * Returns a string containing the SVG path. assumes that the start point is already provided,
     * so anything that calls this needs to put the M calls first
     * @returns {string}
     */
    getSVGPathFragment: function() {
      return 'L ' + kite.svgNumber( this._end.x ) + ' ' + kite.svgNumber( this._end.y );
    },

    /**
     * Returns an array of Line that will draw an offset curve on the logical left side
     * @param {number} lineWidth
     * @returns {Array.<Line>}
     */
    strokeLeft: function( lineWidth ) {
      var offset = this.getEndTangent().perpendicular().negated().times( lineWidth / 2 );
      return [ new kite.Line( this._start.plus( offset ), this._end.plus( offset ) ) ];
    },
    /**
     * Returns an array of Line that will draw an offset curve on the logical right side
     * @param {number} lineWidth
     * @returns {Array.<Line>}
     */
    strokeRight: function( lineWidth ) {
      var offset = this.getStartTangent().perpendicular().times( lineWidth / 2 );
      return [ new kite.Line( this._end.plus( offset ), this._start.plus( offset ) ) ];
    },

    /**
     * In general, this method returns a list of t values where dx/dt or dy/dt is 0 where 0 < t < 1. subdividing on these will result in monotonic segments
     * Since lines are already monotone, it returns an empty array
     * @returns {Array}
     */
    getInteriorExtremaTs: function() { return []; },

    /**
     * Returns an array with 2 sub-segments, split at the parametric t value.
     * @param {number} t
     * @returns {Array.<Line>}
     */
    subdivided: function( t ) {
      var pt = this.positionAt( t );
      return [
        new kite.Line( this._start, pt ),
        new kite.Line( pt, this._end )
      ];
    },

    /**
     *  // TODO complete JSDOC
     * @param {Ray2} ray
     * @returns {Array.<Object>|[]}
     */
    intersection: function( ray ) {
      // We solve for the parametric line-line intersection, and then ensure the parameters are within both
      // the line segment and forwards from the ray.

      var result = [];

      var start = this._start;
      var end = this._end;

      var diff = end.minus( start );

      if ( diff.magnitudeSquared() === 0 ) {
        return result;
      }

      var denom = ray.direction.y * diff.x - ray.direction.x * diff.y;

      // If denominator is 0, the lines are parallel or coincident
      if ( denom === 0 ) {
        return result;
      }

      // linear parameter where start (0) to end (1)
      var t = ( ray.direction.x * ( start.y - ray.position.y ) - ray.direction.y * ( start.x - ray.position.x ) ) / denom;

      // check that the intersection point is between the line segment's endpoints
      if ( t < 0 || t >= 1 ) {
        return result;
      }

      // linear parameter where ray.position (0) to ray.position+ray.direction (1)
      var s = ( diff.x * ( start.y - ray.position.y ) - diff.y * ( start.x - ray.position.x ) ) / denom;

      // bail if it is behind our ray
      if ( s < 0.00000001 ) {
        return result;
      }

      // return the proper winding direction depending on what way our line intersection is "pointed"
      var perp = diff.perpendicular();
      result.push( {
        distance: s,
        point: start.plus( diff.times( t ) ),
        normal: perp.dot( ray.direction ) > 0 ? perp.negated() : perp,
        wind: ray.direction.perpendicular().dot( diff ) < 0 ? 1 : -1,
        segment: this
      } );
      return result;
    },

    /**
     * Returns the resultant winding number of a ray intersecting this line.
     * @param {Ray2} ray
     * @returns {number}
     */
    windingIntersection: function( ray ) {
      var hits = this.intersection( ray );
      if ( hits.length ) {
        return hits[ 0 ].wind;
      }
      else {
        return 0;
      }
    },

    /**
     * Draws this line to the 2D Canvas context, assuming the context's current location is already at the start point
     * @param {CanvasRenderingContext2D} context
     */
    writeToContext: function( context ) {
      context.lineTo( this._end.x, this._end.y );
    },

    /**
     * Returns a new Line that represents this line after transformation by the matrix
     * @param {Matrix3} matrix
     * @returns {Line}
     */
    transformed: function( matrix ) {
      return new kite.Line( matrix.timesVector2( this._start ), matrix.timesVector2( this._end ) );
    },

    /**
     * Returns an object that gives information about the closest point (on a line segment) to the point argument
     * @param {Vector2} point
     * @returns {Array.<Object>}
     */
    explicitClosestToPoint: function( point ) {
      var diff = this._end.minus( this._start );
      var t = point.minus( this._start ).dot( diff ) / diff.magnitudeSquared();
      t = Util.clamp( t, 0, 1 );
      var closestPoint = this.positionAt( t );
      return [
        {
          segment: this,
          t: t,
          closestPoint: closestPoint,
          distanceSquared: point.distanceSquared( closestPoint )
        }
      ];
    },

    /**
     * Given the current curve parameterized by t, will return a curve parameterized by x where t = a * x + b
     * @param {number} a
     * @param {number} b
     * @returns {Line}
     */
    reparameterized: function( a, b ) {
      return new kite.Line( this.positionAt( b ), this.positionAt( a + b ) );
    },

    /**
     * Convert a line in the $(theta,r)$ plane of the form $(\theta_1,r_1)$ to $(\theta_2,r_2)$ and
     * converts to the the cartesian coordinate system
     * E.g. a polar line (0,1) to (2 Pi,1) would be mapped to a circle of radius 1
     * @param {Object} options
     * @returns {Array.<Line>|Array.<Arc>|Array.<Segment>}
     */
    polarToCartesian: function( options ) {
      // x represent an angle whereas y represent a radius
      if ( this._start.x === this._end.x ) {
        // angle is the same, we are still a line segment!
        return [ new kite.Line( Vector2.createPolar( this._start.y, this._start.x ), Vector2.createPolar( this._end.y, this._end.x ) ) ];
      }
      else if ( this._start.y === this._end.y ) {
        // we have a constant radius, so we are a circular arc
        return [ new kite.Arc( Vector2.ZERO, this._start.y, this._start.x, this._end.x, this._start.x > this._end.x ) ];
      }
      else {
        return this.toPiecewiseLinearSegments( options );
      }
    }
  } );

  /**
   * Add getters and setters
   */
  Segment.addInvalidatingGetterSetter( Line, 'start' );
  Segment.addInvalidatingGetterSetter( Line, 'end' );

  return Line;
} );
