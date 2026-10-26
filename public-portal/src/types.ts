export interface SupplyCategory {
  category_id: number;
  name: string;
}

export interface NearestShelter {
  shelter_id: number;
  name: string;
  distance_km: number;
  available_space: number;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  contact_number: string | null;
  has_space: boolean;
}

export interface ShelterListing {
  shelter_id: number;
  name: string;
  capacity_total: number;
  capacity_occupied: number;
  occupancy_pct: number;
  status: 'full' | 'near-full' | 'available';
  // Added to Shelter_Live_Status by the Phase 3 migration. The public list
  // filters on it so a closed shelter is never offered as an option.
  is_active: boolean;
}

export interface DisasterEvent {
  event_id: number;
  name: string;
  region: string | null;
  severity: number | null;
}

