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
  unit: string | null;
  category_id: number | null;
  category_name: string | null;
}

export interface InventoryItem {
  supply_id: number;
  shelter_id: number;
  shelter_name: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  reorder_threshold: number;
  category_id: number | null;
  category_name: string | null;
  below_threshold: boolean;
}

export type RequestStatus = 'pending' | 'partially_fulfilled' | 'fulfilled' | 'cancelled';

export interface RequestNeed {
  need_id: number;
  category_id: number | null;
  category_name: string | null;
  item_label: string;
  quantity_needed: number;
  quantity_allocated: number;
  is_estimate: boolean;
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
  status: RequestStatus;
  needs: RequestNeed[];
}

export interface AllocationRecord {
  allocation_id: number;
  request_id: number | null;
  supply_id: number;
  quantity_allocated: number;
  allocated_at: string;
  need_id: number | null;
  item_name: string;
  unit: string | null;
  shelter_id: number;
  shelter_name: string;
  category_id: number | null;
  category_name: string | null;
  quantity_needed: number | null;
  is_estimate: boolean | null;
  requester_name: string | null;
  phone: string | null;
  request_type: string | null;
  request_status: RequestStatus | null;
  allocated_by_name: string | null;
}

export interface AllocationOutcome {
  success: boolean;
  code: string;
  message: string;
  request_status: RequestStatus | null;
  need_id: number | null;
  remaining_need: number | null;
  available_stock: number | null;
}

export interface SupplyCategory {
  category_id: number;
  name: string;
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
