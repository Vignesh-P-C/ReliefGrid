export interface SupplyCategory {
  category_id: number;
  name: string;
}

export interface NearestShelter {
  shelter_id: number;
  name: string;
  distance_km: number;
  available_space: number;
}
