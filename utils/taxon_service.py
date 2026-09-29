"""Lazily create/refresh local Taxon rows from the laji.fi API."""
from models import Taxon
from proxy.laji import fetch_taxon_info

# e.g. "MX.iucnLC" -> "LC"
_REDLIST_STATUS_PREFIX = 'MX.iucn'


def _redlist_category(info):
    status = (info.get('latestRedListStatusFinland') or {}).get('status')
    if status and status.startswith(_REDLIST_STATUS_PREFIX):
        return status[len(_REDLIST_STATUS_PREFIX):]
    return status


def get_or_create_taxon(db, mx_id):
    """Return the Taxon row for mx_id, fetching its display name/category from the laji.fi API.

    Creates the row on first access and keeps its name/category in sync with the API.
    Returns None if the taxon doesn't exist locally and the API lookup fails.
    """
    taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()

    name = None
    category = None
    try:
        info = fetch_taxon_info(mx_id)
        name = info.get('vernacularName') or info.get('scientificNameDisplayName')
        category = _redlist_category(info)
    except Exception as e:
        print(f"Failed to fetch taxon info for {mx_id} from laji.fi API: {e}")

    if not taxon:
        if not name:
            return None
        taxon = Taxon(mx_id=mx_id, name=name, category=category)
        db.add(taxon)
        db.commit()
        db.refresh(taxon)
    elif name and (taxon.name != name or taxon.category != category):
        taxon.name = name
        taxon.category = category
        db.commit()

    return taxon
