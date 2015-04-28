

MAP.DistanceGrid = function(cellSize)
{
	this._cellSize		= cellSize;
	this._sqCellSize	= cellSize * cellSize;
	this._grid			= {};
	this._objectPoint	= {};
};

MAP.DistanceGrid.prototype.addObject = function(obj, point)
{
	var	p		= this._getCoords(point)
	,	grid	= this._grid
	,	row		= grid[p._y]	= grid[p._y]	|| {}
	,	cell	= row[p._x]		= row[p._x]		|| []
	;
	
	this._objectPoint[MAP.stamp(obj)] = point;
	
	cell.push(obj);
};

MAP.DistanceGrid.prototype.updateObject = function(obj, point)
{
	this.removeObject(obj);
	this.addObject(obj, point);
};

//Returns true if the object was found
MAP.DistanceGrid.prototype.removeObject = function(obj, point)
{
	var	i
	,	p		= this._getCoords(point)
	,	grid	= this._grid
	,	row		= grid[p._y]	= grid[p._y]	|| {}
	,	cell	= row[p._x]		= row[p._x]		|| []
	;
	
	delete this._objectPoint[MAP.stamp(obj)];
	
	i = cell.indexOf(obj);
	if(i > -1)
	// for(i = 0, len = cell.length; i < len; i++)
	{
		// if(cell[i] === obj){
		cell.splice(i, 1);
		
		if(cell.length === 1)
		{
			delete row[p._x];
		}
		
		return true;
		// }
	}
};

MAP.DistanceGrid.prototype.getNearObject = function (point)
{
	var i, j, k, row, cell, len, obj, dist
	,	p				= this._getCoords(point)
	,	objectPoint		= this._objectPoint
	,	closestDistSq	= this._sqCellSize
	,	closest			= null
	;
	
	// TODO this should help increase performance a little bit and it should not matter a lot for the clusters
	// if((row = this._grid[p._y]) && (cell = row[p._x]) && cell[0]){ return cell[0] }
	
	for(i = p._y - 1; i <= p._y + 1; i++)
	{
		if(row = this._grid[i])
		{
			for(j = p._x - 1; j <= p._x + 1; j++)
			{
				if(cell = row[j])
				{
					for(k = 0, len = cell.length; k < len; k++)
					{
						obj		= cell[k];
						dist	= this._sqDist(objectPoint[MAP.stamp(obj)], point);
						if(dist < closestDistSq)
						{
							closestDistSq	= dist;
							closest			= obj;
						}
					}
				}
			}
		}
	}
	
	return closest;
};

MAP.DistanceGrid.prototype._getCoords = function(point)
{
	if(!point._x || !point._y)
	{
		point._x = Math.floor(point.x / this._cellSize);
		point._y = Math.floor(point.y / this._cellSize);
	}
	
	return point;
};

MAP.DistanceGrid.prototype._sqDist = function(p, p2)
{
	var	dx = p2.x - p.x
	,	dy = p2.y - p.y
	;
	return dx * dx + dy * dy;
};
