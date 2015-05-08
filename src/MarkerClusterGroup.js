(function()
{
	
	var	GM = google.maps
	,	GE = GM.event
	;
	
	// TODO: get rid of this? or refactor it
	function FeatureGroup()
	{
		this.map = null;
		this.layers = [];
		this.addLayer = function(layer)
		{
			if(!this.map){ return; }
			
			this.layers.push(layer);
			// console.log(layer);
			layer.setMap(this.map);
		};
		
		this.removeLayer = function(layer)
		{
			var i = this.layers.indexOf(layer);
			if(i > -1){ this.layers.splice(i, 1)[0].setMap(null); }
		};
		
		this.eachLayer = function(cb)
		{
			// console.log(this.layers);
			for(var i = 0; i < this.layers.length; i++){ cb(this.layers[i]); }
		};
		
		this.clearLayers = function(cb)
		{
			for(var i = 0; i < this.layers.length; i++){ this.layers[i].setMap(null); }
			this.layers = [];
		};
	}
	
	
	MAP.MarkerClusterGroup = function(options)
	{
		this._featureGroup = new FeatureGroup();
		
		this._inZoomAnimation	= 0;
		this._needsClustering	= [];
		this._needsRemoving		= [];
		
		this.options = MAP.extend(
		{
			maxClusterRadius: 80,			// A cluster will cover at most this many pixels from its center
			
			zoomToBoundsOnClick: true,
			
			spiderfyOnMaxZoom: true,
			spiderfyDistanceMultiplier: 1,	// Increase to increase the distance away that spiderfied markers appear from the center
			
			disableClusteringAtZoom: null,
			// animateAddingMarkers: false,
			
			// Setting this to false prevents the removal of any clusters outside of the viewpoint, which
			// is the default behaviour for performance reasons.
			// removeOutsideVisibleBounds: true,
			
			chunkedLoading	: false,
			chunkInterval	: 200,			// process markers for a maximum of ~ n milliseconds (then trigger the chunkProgress callback)
			chunkDelay		: 1,			// at the end of each interval, give n milliseconds back to system/browser
			chunkProgress	: null			// progress callback: function(processed, total, elapsed) (e.g. for a progress indicator)
		}, options);
		
		this._queue = [];
	};
	
	MAP.MarkerClusterGroup.prototype = new GM.OverlayView();
	
	
	MAP.MarkerClusterGroup.prototype.ll2px = (function()
	{
		// https://developers.google.com/maps/documentation/javascript/examples/map-coordinates
		var	TILE_SIZE		= 256
		,	TILE_SIZE2		= TILE_SIZE / 2
		,	px_per_lon_deg	= TILE_SIZE / 360
		,	px_per_lon_rad	= TILE_SIZE / (2 * Math.PI)
		,	px_origin		= new GM.Point(TILE_SIZE2, TILE_SIZE2)
		,	PI_180			= Math.PI / 180
		;
		
		function bound(value, opt_min, opt_max)
		{
			if(opt_min){ value = Math.max(value, opt_min); }
			if(opt_max){ value = Math.min(value, opt_max); }
			return value;
		}
		
		function deg2rad(deg){ return deg * (PI_180); }
		
		function projection(lat_lng, zoom)
		{
			var	siny
			,	ntiles	= 1 << zoom
			,	point	= new GM.Point(0, 0)
			;
			
			// Truncating to 0.9999 effectively limits latitude to 89.189. This is about a third of a tile past the edge of the world tile.
			siny = bound(Math.sin(deg2rad(lat_lng.lat())), -0.9999, 0.9999);
			
			point.x = parseInt((px_origin.x + lat_lng.lng() * px_per_lon_deg) * ntiles);
			point.y = parseInt((px_origin.y + 0.5 * Math.log((1 + siny) / (1 - siny)) * -px_per_lon_rad) * ntiles);
			
			return point;
		}
		
		return function(obj, lat_lng, zoom)
		{
			if(!obj.__projection_px){ obj.__projection_px = []; }
			
			return obj.__projection_px[zoom] || (obj.__projection_px[zoom] = projection(lat_lng, zoom));
		};
	}());
	
	
	// ======= Google Maps Functions =======
	
	MAP.MarkerClusterGroup.prototype.draw = function(){};
	
	MAP.MarkerClusterGroup.prototype.onAdd = function()
	{
		this._featureGroup.map = this.map;
		
		if(!this._gridClusters)
		{
			this._generateInitialClusters();
		}
		
		// for (i = 0, l = this._needsRemoving.length; i < l; i++) {
		// 	layer = this._needsRemoving[i];
		// 	this._removeLayer(layer, true);
		// }
		this._needsRemoving = [];
		
		// Remember the current zoom level and bounds
		this._zoom = this.map.getZoom();
		this._currentShownBounds = this._getExpandedVisibleBounds();
		
		// TODO: move this in spiderify.js with bind and call 
		if(this._spiderfierOnAdd){ this._spiderfierOnAdd(); }
		
		this._bindEvents();
		
		// Actually add our markers to the map:
		l = this._needsClustering;
		this._needsClustering = [];
		this.addLayers(l);
	};
	
	MAP.MarkerClusterGroup.prototype.onRemove = function(map)
	{
		this._unbindEvents();
		
		// In case we are in a cluster animation
		// this._map._mapPane.className = this._map._mapPane.className.replace(' leaflet-cluster-anim', '');
		
		// if (this._spiderfierOnRemove) { //TODO FIXME: Not sure how to have spiderfier add something on here nicely
		// 	this._spiderfierOnRemove();
		// }
		
		// Clean up all the layers we added to the map
		this._featureGroup.clearLayers();
	};
	
	
	
	// ======= Signle Layer Functions =======
	
	MAP.MarkerClusterGroup.prototype.hasLayer = function(layer)
	{
		// TODO Refactor this in a single return
		if(!layer){ return false; }
		
		if(layer.__parent && layer.__parent._group === this) return true;
		
		if(this._needsClustering.indexOf(layer) > -1){ return true; }
		// var i, anArray = this._needsClustering;
		// for(i = anArray.length - 1; i >= 0; i--) {
		// 	if (anArray[i] === layer) {
		// 		return true;
		// 	}
		// }
		
		if(this._needsRemoving.indexOf(layer) > -1){ return false; }
		// anArray = this._needsRemoving;
		// for (i = anArray.length - 1; i >= 0; i--) {
		// 	if (anArray[i] === layer) {
		// 		return false;
		// 	}
		// }
		
		return !!(layer.__parent && layer.__parent._group === this); // || this._nonPointGroup.hasLayer(layer);
	};
	
	MAP.MarkerClusterGroup.prototype.addLayer = function(layer)
	{
		// if (layer instanceof L.LayerGroup) {
		// 	var array = [];
		// 	for (var i in layer._layers) {
		// 		array.push(layer._layers[i]);
		// 	}
		// 	return this.addLayers(array);
		// }
		
		//Don't cluster non point data
		// if (!layer.getLatLng) {
		// 	this._nonPointGroup.addLayer(layer);
		// 	return this;
		// }
		
		if(!this._topClusterLevel)
		{
			this._needsClustering.push(layer);
			return; // this;
		}
		
		if (this.hasLayer(layer)) {
			return this;
		}
		
		if(this._unspiderfy)
		{
			this._unspiderfy();
		}
		
		this._addLayer(layer, this._maxZoom);
		
		//Work out what is visible
		var visibleLayer = layer, currentZoom = this.map.getZoom();
		if(layer.__parent)
		{
			while(visibleLayer.__parent._zoom >= currentZoom){ visibleLayer = visibleLayer.__parent; }
		}
		
		if(this._currentShownBounds.contains(visibleLayer.position))
		{
			this._animationAddLayer(layer, visibleLayer);
		}
	};
	
	MAP.MarkerClusterGroup.prototype.removeLayer = function(layer)
	{
		// if (layer instanceof L.LayerGroup)
		// {
		// 	var array = [];
		// 	for (var i in layer._layers) {
		// 		array.push(layer._layers[i]);
		// 	}
		// 	return this.removeLayers(array);
		// }
		
		// Non point layers
		// if (!layer.getLatLng) {
		// 	this._nonPointGroup.removeLayer(layer);
		// 	return this;
		// }
		
		// if (!this._map) {
		// 	if (!this._arraySplice(this._needsClustering, layer) && this.hasLayer(layer)) {
		// 		this._needsRemoving.push(layer);
		// 	}
		// 	return this;
		// }
		
		// if (!layer.__parent) {
		// 	return this;
		// }
		
		// if (this._unspiderfy) {
		// 	this._unspiderfy();
		// 	this._unspiderfyLayer(layer);
		// }
		
		// //Remove the marker from clusters
		// this._removeLayer(layer, true);
		
		// if (this._featureGroup.hasLayer(layer)) {
		// 	this._featureGroup.removeLayer(layer);
		// 	if (layer.setOpacity) {
		// 		layer.setOpacity(1);
		// 	}
		// }
		
		return this;
	};
	
	
	
	// ======= All Layers Functions =======
	
	MAP.MarkerClusterGroup.prototype.addLayers = function(layersArray)
	{
		var	newMarkers, i, l, m, markers
		,	fg				= this._featureGroup
		// 	npg = this._nonPointGroup,
		,	chunked			= this.options.chunkedLoading
		,	chunkInterval	= this.options.chunkInterval
		,	chunkProgress	= this.options.chunkProgress
		,	chunkDelay		= this.options.chunkDelay
		;
		
		if(this._topClusterLevel)
		{
			console.log('has map, layers: ' + layersArray.length);
			var offset = 0, started = (new Date()).getTime();
			
			var process = MAP.bind(function()
			{
				var start = (new Date()).getTime();
				
				for(; offset < layersArray.length; offset++)
				{
					if(chunked && offset % 250 === 0)
					{
						// every couple hundred markers, instrument the time elapsed since processing started:
						var elapsed = (new Date()).getTime() - start;
						if(elapsed > chunkInterval){ break; } // take a break
					}
					
					m = layersArray[offset];
					
					//Not point data, can't be clustered
					// if(!m.getPosition)
					// {
					// 	npg.addLayer(m);
					// 	continue;
					// }
					
					// console.log(this.hasLayer(m), this._needsClustering);
					
					if(this.hasLayer(m)){ continue; }
					
					this._addLayer(m, this._maxZoom);
					
					//If we just made a cluster of size 2 then we need to remove the other marker from the map (if it is) or we never will
					if(m.__parent && m.__parent.getChildCount() === 2)
					{
						markers		= m.__parent.getAllChildMarkers();
						fg.removeLayer(markers[0] === m ? markers[1] : markers[0]);
					}
				}
				
				if(chunkProgress){ chunkProgress(offset, layersArray.length, (new Date()).getTime() - started); }
				
				if(offset === layersArray.length)
				{
					// alert('markers loaded for' + ( (new Date).getTime() - started ) + 'ms');
					
					this._topClusterLevel._recursivelyAddChildrenToMap(null, this._zoom, this._currentShownBounds);
					
					// Update the icons of all those visible clusters that were affected
					fg.eachLayer(function(c)
					{
						if(c instanceof MAP.MarkerCluster && c._iconNeedsUpdate){ c._updateIcon(); }
					});
				}
				else
				{
					setTimeout(process, chunkDelay);
				}
			}, this);
			
			process();
		}
		else
		{
			console.warn('has no map');
			
			newMarkers = [];
			for(i = 0, l = layersArray.length; i < l; i++)
			{
				m = layersArray[i];
			// 	//Not point data, can't be clustered
			// 	if (!m.getLatLng) {
			// 		npg.addLayer(m);
			// 		continue;
			// 	}
				
				if(this.hasLayer(m)){ continue; }
				
				newMarkers.push(m);
			}
			
			this._needsClustering = this._needsClustering.concat(newMarkers);
		}
		return this;
	};
	
	MAP.MarkerClusterGroup.prototype.removeLayers = function(layersArray)
	{
		// var i, l, m,
		// 	fg = this._featureGroup,
		// 	npg = this._nonPointGroup;
		
		// if (this._unspiderfy) {
		// 	this._unspiderfy();
		// }
		
		// if (!this._map) {
		// 	for (i = 0, l = layersArray.length; i < l; i++) {
		// 		m = layersArray[i];
		// 		this._arraySplice(this._needsClustering, m);
		// 		npg.removeLayer(m);
		// 	}
		// 	return this;
		// }
		
		// for (i = 0, l = layersArray.length; i < l; i++) {
		// 	m = layersArray[i];
		
		// 	// if (!m.__parent) {
		// 	// 	npg.removeLayer(m);
		// 	// 	continue;
		// 	// }
		
		// 	this._removeLayer(m, true, true);
		
		// 	if (fg.hasLayer(m)) {
		// 		fg.removeLayer(m);
		// 		if (m.setOpacity) {
		// 			m.setOpacity(1);
		// 		}
		// 	}
		// }
		
		//Fix up the clusters and markers on the map
		// this._topClusterLevel._recursivelyAddChildrenToMap(null, this._zoom, this._currentShownBounds);
		
		// fg.eachLayer(function (c) {
		// 	if (c instanceof MarkerCluster) {
		// 		c._updateIcon();
		// 	}
		// });
	
		// return this;
	};
	
	MAP.MarkerClusterGroup.prototype.clearLayers = function()
	{
		//If we aren't on the map (yet), blow away the markers we know of
		if(!this.map)
		{
			this._needsClustering = [];
			delete this._gridClusters;
			delete this._gridUnclustered;
		}
		
		if(this._noanimationUnspiderfy)
		{
			this._noanimationUnspiderfy();
		}
		
		//Remove all the visible layers
		this._featureGroup.clearLayers();
		// this._nonPointGroup.clearLayers();
		
		
		if(this._topClusterLevel)
		{
			var markers = this._topClusterLevel.getAllChildMarkers();
			for(i = markers.length - 1; i >= 0; i--)
			{
				delete markers[i].__parent;
			}
		}
		
		if(this.map)
		{
			//Reset _topClusterLevel and the DistanceGrids
			this._generateInitialClusters();
		}
		
		// return this;
	};
	
	
	// ======= Special Layers Functions =======
	
	// Zoom: Zoom to start adding at (Pass this._maxZoom to start at the bottom)
	MAP.MarkerClusterGroup.prototype._addLayer = function (layer, zoom)
	{
		var	markerPoint, z
		,	gridClusters	= this._gridClusters
		,	gridUnclustered	= this._gridUnclustered
		;
		
		// if(this.options.singleMarkerMode)
		// {
		// 	layer.options.icon = this.options.iconCreateFunction({
		// 		getChildCount: function () {
		// 			return 1;
		// 		},
		// 		getAllChildMarkers: function () {
		// 			return [layer];
		// 		}
		// 	});
		// }
		
		//Find the lowest zoom level to slot this one in
		for(; zoom >= 0; zoom--)
		{
			markerPoint = this.ll2px(layer, layer.getPosition(), zoom); // calculate pixel position
			
			//Try find a cluster close by
			var closest = gridClusters[zoom].getNearObject(markerPoint);
			// console.log(markerPoint, this.map.zoom);
			if(closest)
			{
				closest._addChild(layer);
				layer.__parent = closest;
				
				return;
			}
			
			//Try find a marker close by to form a new cluster with
			// console.log(markerPoint);
			closest = gridUnclustered[zoom].getNearObject(markerPoint);
			if(closest)
			{
				var parent = closest.__parent;
				if (parent){ this._removeLayer(closest, false); }
				
				//Create new cluster with these 2 in it
				var newCluster = new MAP.MarkerCluster(this, zoom, closest, layer);
				gridClusters[zoom].addObject(newCluster, this.ll2px(newCluster, newCluster._cPosition, zoom));
				closest.__parent = newCluster;
				layer.__parent = newCluster;
				
				//First create any new intermediate parent clusters that doesn't exist
				var lastParent = newCluster;
				for(z = zoom - 1; z > parent._zoom; z--)
				{
					lastParent = new MAP.MarkerCluster(this, z, lastParent);
					gridClusters[z].addObject(lastParent, this.ll2px(closest, closest.getPosition(), z));
				}
				parent._addChild(lastParent);
				
				//Remove closest from this zoom level and any above that it is in, replace with newCluster
				for(z = zoom; z >= 0; z--)
				{
					if(!gridUnclustered[z].removeObject(closest, this.ll2px(closest, closest.getPosition(), z))){ break; }
				}
				
				return;
			}
			
			//Didn't manage to cluster in at this zoom, record us as a marker here and continue upwards
			gridUnclustered[zoom].addObject(layer, markerPoint);
		}
		
		
		// console.log(this._topClusterLevel, layer);
		
		//Didn't get in anything, add us to the top
		this._topClusterLevel._addChild(layer);
		layer.__parent = this._topClusterLevel;
		
		return;
	};
	
	MAP.MarkerClusterGroup.prototype._removeLayer = function(marker, removeFromDistanceGrid, dontUpdateMap)
	{
		var	gridClusters	= this._gridClusters,
			gridUnclustered	= this._gridUnclustered,
			fg				= this._featureGroup
		;
		
		//Remove the marker from distance clusters it might be in
		if(removeFromDistanceGrid)
		{
			for (var z = this._maxZoom; z >= 0; z--)
			{
				if(!gridUnclustered[z].removeObject(marker, this.ll2px(marker, marker.getPosition(), z))){ break; }
			}
		}
		
		//Work our way up the clusters removing them as we go if required
		var cluster	= marker.__parent,
			markers	= cluster._markers,
			i, otherMarker
		;
		
		//Remove the marker from the immediate parents marker list
		// this._arraySplice(markers, marker);
		if((i = markers.indexOf(marker)) > -1){ markers.splice(i, 1); }
		
		while (cluster)
		{
			cluster._childCount--;
			
			//Top level, do nothing
			if(cluster._zoom < 0){ break; }
			else if(removeFromDistanceGrid && cluster._childCount <= 1) //Cluster no longer required
			{
				//We need to push the other marker up to the parent
				otherMarker = cluster._markers[0] === marker ? cluster._markers[1] : cluster._markers[0];
				
				//Update distance grid
				gridClusters[cluster._zoom].removeObject(cluster, this.ll2px(cluster, cluster._cPosition, cluster._zoom));
				gridUnclustered[cluster._zoom].addObject(otherMarker, this.ll2px(otherMarker, otherMarker.getPosition(), cluster._zoom));
				
				//Move otherMarker up to parent
				this._arraySplice(cluster.__parent._childClusters, cluster);
				cluster.__parent._markers.push(otherMarker);
				otherMarker.__parent = cluster.__parent;
				
				if(cluster._icon)
				{
					//Cluster is currently on the map, need to put the marker on the map instead
					fg.removeLayer(cluster);
					if(!dontUpdateMap){ fg.addLayer(otherMarker); }
				}
			}
			else
			{
				cluster._recalculateBounds();
				// if(!dontUpdateMap || !cluster._icon){ cluster._updateIcon(); }
			}
			
			cluster = cluster.__parent;
		}
		
		delete marker.__parent;
	};
	
	
	// ======= Event Functions =======
	
	MAP.MarkerClusterGroup.prototype._bindEvents = function()
	{
		var _this = this;
		
		GE.addListener(this.map, 'zoom_changed', function(){ _this._zoomEnd(); });
		// GE.addListener(this.map, 'dragend', function(){ _this._moveEnd(); });
		// this._map.on('moveend', this._moveEnd, this);
		
		// var map = this.map,
		//     spiderfyOnMaxZoom = this.options.spiderfyOnMaxZoom,
		//     showCoverageOnHover = this.options.showCoverageOnHover,
		//     zoomToBoundsOnClick = this.options.zoomToBoundsOnClick;
		
		// //Zoom on cluster click or spiderfy if we are at the lowest level
		// if (spiderfyOnMaxZoom || zoomToBoundsOnClick) {
		// 	this.on('clusterclick', this._zoomOrSpiderfy, this);
		// }
		
		// //Show convex hull (boundary) polygon on mouse over
		// if (showCoverageOnHover) {
		// 	this.on('clustermouseover', this._showCoverage, this);
		// 	this.on('clustermouseout', this._hideCoverage, this);
		// 	map.on('zoomend', this._hideCoverage, this);
		// }
	};
	
	MAP.MarkerClusterGroup.prototype._unbindEvents = function()
	{
		// map.off('zoomend', this._zoomEnd, this);
		// map.off('moveend', this._moveEnd, this);
		
		// var spiderfyOnMaxZoom = this.options.spiderfyOnMaxZoom,
		// 	showCoverageOnHover = this.options.showCoverageOnHover,
		// 	zoomToBoundsOnClick = this.options.zoomToBoundsOnClick,
		// 	map = this._map;
		
		// if (spiderfyOnMaxZoom || zoomToBoundsOnClick) {
		// 	this.off('clusterclick', this._zoomOrSpiderfy, this);
		// }
		// if (showCoverageOnHover) {
		// 	this.off('clustermouseover', this._showCoverage, this);
		// 	this.off('clustermouseout', this._hideCoverage, this);
		// 	map.off('zoomend', this._hideCoverage, this);
		// }
	};
	
	
	MAP.MarkerClusterGroup.prototype._zoomEnd = function()
	{
		//May have been removed from the map by a zoomEnd handler
		if(!this._topClusterLevel){ return; }
		
		this._mergeSplitClusters();
		
		this._zoom = this.map.getZoom();
		this._currentShownBounds = this._getExpandedVisibleBounds();
	};
	
	MAP.MarkerClusterGroup.prototype._moveEnd = function()
	{
		if(this._inZoomAnimation){ return; }
		
		var newBounds = this._getExpandedVisibleBounds();
		
		this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, this._zoom, newBounds);
		this._topClusterLevel._recursivelyAddChildrenToMap(null, this.map.getZoom(), newBounds);
		
		this._currentShownBounds = newBounds;
	};
	
	
	// ======= Misc Functions ======
	
	// Gets the maps visible bounds expanded in each direction by the size of the screen (so the user cannot see an area we do not cover in one pan)
	MAP.MarkerClusterGroup.prototype._getExpandedVisibleBounds = function()
	{
		// if(!this.options.removeOutsideVisibleBounds){ return this.map.getBounds(); }
		
		var	bounds	= this.map.getBounds()
		,	sw		= bounds.getSouthWest()
		,	ne		= bounds.getNorthEast()
		,	latDiff	= Math.abs(sw.lat() - ne.lat()) // L.Browser.mobile ? 0 : Math.abs(sw.lat - ne.lat)
		,	lngDiff	= Math.abs(sw.lng() - ne.lng()) // L.Browser.mobile ? 0 : Math.abs(sw.lng - ne.lng)
		;
		
		return new GM.LatLngBounds(new GM.LatLng(sw.lat() - latDiff, sw.lng() - lngDiff, true), new GM.LatLng(ne.lat() + latDiff, ne.lng() + lngDiff, true));
	};
	
	MAP.MarkerClusterGroup.prototype._generateInitialClusters = function()
	{
		var	zoom
		,	maxZoom		= this.map.maxZoom || 21
		,	radius		= this.options.maxClusterRadius
		,	radiusFn	= radius
		;
		
		//If we just set maxClusterRadius to a single number, we need to create
		//a simple function to return that number. Otherwise, we just have to
		//use the function we've passed in.
		if(typeof radius !== 'function'){ radiusFn = function(){ return radius; }; }
		
		if(this.options.disableClusteringAtZoom)
		{
			maxZoom = this.options.disableClusteringAtZoom - 1;
		}
		
		this._maxZoom			= maxZoom;
		this._gridClusters		= {};
		this._gridUnclustered	= {};
		
		//Set up DistanceGrids for each zoom
		for(zoom = maxZoom; zoom >= 0; zoom--)
		{
			this._gridClusters[zoom] = new MAP.DistanceGrid(radiusFn(zoom));
			this._gridUnclustered[zoom] = new MAP.DistanceGrid(radiusFn(zoom));
		}
		
		this._topClusterLevel = new MAP.MarkerCluster(this, -1);
	};
	
	// Merge and split any existing clusters that are too big or small
	MAP.MarkerClusterGroup.prototype._mergeSplitClusters = function()
	{
		//Incase we are starting to split before the animation finished
		this._processQueue();
		
		if(this._zoom < this.map.getZoom() && this._currentShownBounds.intersects(this._getExpandedVisibleBounds())) //Zoom in, split
		{
			this._animationStart();
			//Remove clusters now off screen
			this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, this._zoom, this._getExpandedVisibleBounds());
			
			this._animationZoomIn(this._zoom, this.map.getZoom());
		}
		else if (this._zoom > this.map.getZoom()) //Zoom out, merge
		{
			this._animationStart();
			this._animationZoomOut(this._zoom, this.map.getZoom());
		}
		else
		{
			console.log('TODO move end?');
			this._moveEnd();
		}
	};
	
	MAP.MarkerClusterGroup.prototype._processQueue = function()
	{
		for (var i = 0; i < this._queue.length; i++){ this._queue[i].call(this); }
		this._queue.length = 0;
		clearTimeout(this._queueTimeout);
		this._queueTimeout = null;
	};
	
	
	MAP.MarkerClusterGroup.prototype.getFingerprint = function()
	{
		var	i
		,	fingerprint	= []
		,	layers		= this._featureGroup.layers
		,	bounds		= this.map.getBounds()
		;
		
		for(i = layers.length - 1; i >= 0; --i)
		{
			if(bounds.contains(layers[i].position))
			{
				fingerprint.push(MAP.stamp(layers[i]));
			}
		}
		
		return fingerprint.join();
	};
	
	
	// ======= Animations Functions ======
	
	if(MAP.TRANSITIONS)
	{
		// This will look a lot better if zoomin/out animation is somehow disabled. 
		// 		Though there is no way to do this currently and there is a jumping-like effect
		// https://code.google.com/p/gmaps-api-issues/issues/detail?id=3397
		// https://code.google.com/p/gmaps-api-issues/issues/detail?id=3033
		// Also AFAIK there is currently no way to use transition for makrer position
		
		console.log('transitions');
		
		// Enqueue code to fire after the marker expand/contract has happened
		MAP.MarkerClusterGroup.prototype._enqueue = function(fn)
		{
			this._queue.push(fn);
			if(!this._queueTimeout){ this._queueTimeout = setTimeout(MAP.bind(this._processQueue, this), 300); }
		};
		
		// Force a browser layout of stuff in the map
		// Should apply the current opacity and location to all elements so we can update them again for an animation
		MAP.MarkerClusterGroup.prototype._forceLayout = function()
		{
			//In my testing this works, infact offsetWidth of any element seems to work.
			//Could loop all this._layers and do this for each _icon if it stops working
			
			// TODO do we need this
			// L.Util.falseFn(document.body.offsetWidth);
		};
		
		MAP.MarkerClusterGroup.prototype._animationStart = function()
		{
			if(this.map){ this.map.getDiv().className += ' cluster-anim'; }
			this._inZoomAnimation++;
		};
		
		MAP.MarkerClusterGroup.prototype._animationEnd = function()
		{
			if(this.map){ this.map.getDiv().className = this.map.getDiv().className.replace(/ cluster-anim/g, ''); }
			
			this._inZoomAnimation--;
			// this.fire('animationend');
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomIn = function(previousZoomLevel, newZoomLevel)
		{
			var	i
			,	bounds	= this._getExpandedVisibleBounds()
			,	fg		= this._featureGroup
			;
			
			//Add all children of current clusters to map and remove those clusters from map
			this._topClusterLevel._recursively(bounds, previousZoomLevel, 0, function(c)
			{
				var	m
				,	startPos	= c.position
				,	markers		= c._markers
				;
				
				if(!bounds.contains(startPos)){ startPos = null; }
				
				if(c._isSingleParent() && previousZoomLevel + 1 === newZoomLevel) // Immediately add the new child and remove us
				{
					fg.removeLayer(c);
					c._recursivelyAddChildrenToMap(null, newZoomLevel, bounds);
				}
				else
				{
					//Fade out old cluster
					c.setOpacity(0);
					c._recursivelyAddChildrenToMap(startPos, newZoomLevel, bounds);
				}
				
				//Remove all markers that aren't visible any more
				//TODO: Do we actually need to do this on the higher levels too?
				for(i = markers.length - 1; i >= 0; i--)
				{
					m = markers[i];
					
					if(!bounds.contains(m.position)){ fg.removeLayer(m); }
				}
			});
			
			// this._forceLayout();
			
			// Update opacities
			this._topClusterLevel._recursivelyBecomeVisible(bounds, newZoomLevel);
			
			// TODO Maybe? Update markers in _recursivelyBecomeVisible
			fg.eachLayer(function(n)
			{
				if(!(n instanceof MAP.MarkerCluster) && n.map){ n.setOpacity(1); }
			});
			
			// update the positions of the just added clusters/markers
			this._topClusterLevel._recursively(bounds, previousZoomLevel, newZoomLevel, function(c)
			{
				c._recursivelyRestoreChildPositions(newZoomLevel);
			});
			
			// Remove the old clusters and close the zoom animation
			this._enqueue(function()
			{
				//update the positions of the just added clusters/markers
				this._topClusterLevel._recursively(bounds, previousZoomLevel, 0, function(c)
				{
					c.setOpacity(1);
					fg.removeLayer(c);
				});
				
				this._animationEnd();
			});
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomOut = function(previousZoomLevel, newZoomLevel)
		{
			setTimeout(MAP.bind(function()
			{
				this._animationZoomOutSingle(this._topClusterLevel, previousZoomLevel - 1, newZoomLevel);
				this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel, this._getExpandedVisibleBounds());
				this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
			}, this), 300);
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomOutSingle = function(cluster, previousZoomLevel, newZoomLevel)
		{
			var me = this, bounds = this._getExpandedVisibleBounds();
			
			// Animate all of the markers in the clusters to move to their cluster center point
			cluster._recursivelyAnimateChildrenInAndAddSelfToMap(bounds, previousZoomLevel + 1, newZoomLevel);
			
			// Update the opacity (If we immediately set it they won't animate)
			// this._forceLayout();
			cluster._recursivelyBecomeVisible(bounds, newZoomLevel);
			
			// TODO: Maybe use the transition timing stuff to make this more reliable
			// When the animations are done, tidy up
			this._enqueue(function()
			{
				// This cluster stopped being a cluster before the timeout fired
				if(cluster._childCount === 1)
				{
					var m = cluster._markers[0];
					//If we were in a cluster animation at the time then the opacity and position of our child could be wrong now, so fix it
					m.setPosition(m.position);
					if (m.setOpacity){ m.setOpacity(1); }
				}
				else
				{
					cluster._recursively(bounds, newZoomLevel, 0, function(c){ c._recursivelyRemoveChildrenFromMap(bounds, previousZoomLevel + 1); });
				}
				
				me._animationEnd();
			});
		};
		
		MAP.MarkerClusterGroup.prototype._animationAddLayer = function(layer, newCluster)
		{
			var me = this, fg = this._featureGroup;
			
			fg.addLayer(layer);
			if(newCluster !== layer)
			{
				if(newCluster._childCount > 2) // Was already a cluster
				{
					newCluster._updateIcon();
					// this._forceLayout();
					this._animationStart();
					
					layer.setPosition(this.getProjection().fromLatLngToDivPixel(newCluster.getPosition()));
					layer.setOpacity(0);
					
					this._enqueue(function()
					{
						fg.removeLayer(layer);
						layer.setOpacity(1);
						me._animationEnd();
					});
				}
				else //Just became a cluster
				{
					// this._forceLayout();
					
					me._animationStart();
					me._animationZoomOutSingle(newCluster, this.map.getMaxZoom(), this.map.getZoom());
				}
			}
		};
	}
	else
	{
		MAP.MarkerClusterGroup.prototype._animationStart = function()
		{
			//Do nothing...
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomIn = function(previousZoomLevel, newZoomLevel)
		{
			this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel);
			this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
			
			// We didn't actually animate, but we use this event to mean "clustering animations have finished"
			// this.fire('animationend');
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomOut = function(previousZoomLevel, newZoomLevel)
		{
			this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel);
			this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
			
			// We didn't actually animate, but we use this event to mean "clustering animations have finished"
			// this.fire('animationend');
		};
		
		MAP.MarkerClusterGroup.prototype._animationAddLayer = function(layer, newCluster)
		{
			if(newCluster === layer)
			{
				this._featureGroup.addLayer(layer);
			}
			else if(newCluster._childCount === 2)
			{
				newCluster._addToMap();
				
				var markers = newCluster.getAllChildMarkers();
				this._featureGroup.removeLayer(markers[0]);
				this._featureGroup.removeLayer(markers[1]);
			}
			else
			{
				newCluster._updateIcon();
			}
		};
	}
}());