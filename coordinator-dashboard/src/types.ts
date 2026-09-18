export interface ShelterLiveStatus {
  shelter_id: number;
  name: string;
  capacity_total: number;
  capacity_occupied: number;
  occupancy_pct: number;
  status: 'full' | 'near-full' | 'available';
}

export interface RankedShelter {
  shelter_id: number;
  name: string;
  event_id: number;
  occupancy_pct: number;
  occupancy_rank: number;
}

export interface ShortageItem {
  shelter_id: number;
  shelter_name: string;
  item_name: string;
  quantity: number;
  reorder_threshold: number;
}

export interface QueuedRequest {
  request_id: number;
  requester_name: string;
  urgency_level: number;
  num_people: number;
  waiting_minutes: number;
}

export interface AuthUser {
  user_id: number;
  name: string;
  role: 'Admin' | 'ShelterCoordinator' | 'Volunteer';
}
