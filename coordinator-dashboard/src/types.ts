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
