export interface ShelterLiveStatus {
  shelter_id: number;
  name: string;
  capacity_total: number;
  capacity_occupied: number;
  occupancy_pct: number;
  status: 'full' | 'near-full' | 'available';
  event_id: number | null;
  event_name: string | null;
  is_active: boolean;
}

export interface RankedShelter {
  shelter_id: number;
  name: string;
  event_id: number | null;
  event_name: string | null;
  occupancy_pct: number;
  occupancy_rank: number;
}

export interface ShortageItem {
  supply_id: number;
  shelter_id: number;
  shelter_name: string;
  item_name: string;
  quantity: number;
  reorder_threshold: number;
}

export interface QueuedRequest {
  request_id: number;
  requester_name: string | null;
  phone: string | null;
  request_type: string | null;
  urgency_level: number | null;
  reviewed_priority: number | null;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  effective_priority: number;
  num_people: number;
  waiting_minutes: number;
  created_at: string;
  location_status: 'available' | 'missing' | 'invalid' | 'restricted';
  latitude: number | null;
  longitude: number | null;
  nearest_shelter_name: string | null;
  nearest_shelter_distance_km: number | null;
  nearest_shelter_available_space: number | null;
}

export interface VolunteerTask {
  task_id: number;
  parent_task_id: number | null;
  description: string;
  status: string;
  depth: number;
}

export interface AuthUser {
  user_id: number;
  name: string;
  role: 'Admin' | 'ShelterCoordinator' | 'Volunteer';
}
