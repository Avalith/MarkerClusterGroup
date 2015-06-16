MAP.DistanceGrid = function(cellSize)
{
	this._cellSize		= cellSize;
	this._sqCellSize	= cellSize * cellSize;
	this._grid			= {};
	this._objectPoint	= {};
};

MAP.DistanceGrid.prototype.addObject = function(obj, point)
{
	var	row, cell
	,	p		= this._getCoords(point)
	,	_x		= p._x
	,	_y		= p._y
	,	grid	= this._grid
	;
	
	if(_y in grid)
	{
		row = grid[_y];
		cell = _x in row ? row[_x] : (row[_x] = []);
	}
	else
	{
		row = grid[_y] = {};
		cell = row[_x] = [];
	}
	
	point._cell = cell;
	this._objectPoint[obj.__stamp_id] = point;
	
	cell.push(obj);
};

// MAP.DistanceGrid.prototype.updateObject = function(obj, point)
// {
// 	this.removeObject(obj);
// 	this.addObject(obj, point);
// };

//Returns true if the object was found
MAP.DistanceGrid.prototype.removeObject = function(obj, point)
{
	if(!('_cell' in point)){ return; }
	
	var	i, cell = point._cell;
	
	// console.log(this._objectPoint[obj.__stamp_id]);
	
	
	if(MAP.spliceIndexOf(cell, obj))
	{
		delete this._objectPoint[obj.__stamp_id];
		delete point._cell;
		
		if(cell.length === 1)
		{
			delete this._grid[point._y];
		}
		
		return true;
	}
};

MAP.DistanceGrid.prototype.getNearObject = function(point)
{
	var i, j, k, row, cell, len, obj, dist
	,	p				= this._getCoords(point)
	,	sqDist			= this._sqDist
	,	objectPoint		= this._objectPoint
	,	closestDistSq	= this._sqCellSize
	,	grid			= this._grid
	,	closest			= null
	;
	
	for(i = -1; i <= 1; i++)
	{
		if(row = grid[p._y + i])
		{
			for(j = -1; j <= 1; j++)
			{
				if(cell = row[p._x + j])
				{
					for(k = 0, len = cell.length; k < len; k++)
					{
						obj		= cell[k];
						dist	= sqDist(objectPoint[obj.__stamp_id], point);
						
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

MAP.DistanceGrid.prototype._sqDist = function(p1, p2)
{
	var	dx = p2.x - p1.x
	,	dy = p2.y - p1.y
	;
	return dx * dx + dy * dy;
};
