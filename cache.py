"""
Cache module for red list evaluatiotn tool application.
Provides in-memory TTL-based caching for stats, taxon hierarchy, etc.
"""

from datetime import datetime, timedelta

class SimpleCache:
    """Simple in-memory cache with TTL (time-to-live) support."""
    
    def __init__(self, ttl_seconds=300):
        self.cache = {}
        self.ttl = timedelta(seconds=ttl_seconds)
    
    def get(self, key):
        if key in self.cache:
            value, timestamp = self.cache[key]
            if datetime.utcnow() - timestamp < self.ttl:
                return value
            else:
                del self.cache[key]
        return None
    
    def set(self, key, value):
        self.cache[key] = (value, datetime.utcnow())
    
    def delete(self, key):
        if key in self.cache:
            del self.cache[key]
    
    def clear(self):
        self.cache.clear()

# Initialize global stats cache (5 minute TTL)
stats_cache = SimpleCache(ttl_seconds=300)
