const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const postgresDir = path.join(root, 'postgres');
const sourceDir = path.join(root, 'source_snapshots');
const metadataDir = path.join(root, 'metadata');
for (const dir of [postgresDir, sourceDir, metadataDir]) fs.mkdirSync(dir, { recursive: true });

let seed = 20261016;
function randomInt(max) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % max;
}
const pad = (value, width = 4) => String(value).padStart(width, '0');
const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
function writeCsv(file, columns, rows) {
  const body = [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n');
  fs.writeFileSync(file, `${body}\r\n`, 'utf8');
}

const events = [
  { event_id: 1, name: 'Andhra Pradesh & Tamil Nadu Cyclone 1990', type: 'Cyclone', region: 'Andhra Pradesh and Tamil Nadu', severity: 3, start_date: '1990-01-01', end_date: '' },
  { event_id: 2, name: 'Uttarkashi Earthquake 1991', type: 'Earthquake', region: 'Uttar Kashi, Uttar Pradesh', severity: 3, start_date: '1991-10-20', end_date: '' },
  { event_id: 3, name: 'Central India Floods 1993', type: 'Floods', region: '12 states incl. Assam, Bihar, Gujarat, Punjab, Rajasthan, UP (CSO lists all 12)', severity: 4, start_date: '1993-01-01', end_date: '' },
  { event_id: 4, name: 'Andhra Pradesh Cyclone 1996', type: 'Cyclone', region: 'Andhra Pradesh', severity: 3, start_date: '1996-11-06', end_date: '' },
  { event_id: 5, name: 'Odisha Super Cyclone 1999', type: 'Cyclone', region: 'Odisha', severity: 5, start_date: '1999-10-29', end_date: '' },
  { event_id: 6, name: 'Gujarat Earthquake 2001', type: 'Earthquake', region: 'Gujarat', severity: 5, start_date: '2001-01-26', end_date: '' },
  { event_id: 7, name: 'Indian Ocean Tsunami 2004', type: 'Tsunami', region: 'Andaman & Nicobar Islands, Andhra Pradesh, Tamil Nadu, Puducherry', severity: 5, start_date: '2004-12-26', end_date: '' },
  { event_id: 8, name: 'Kosi Floods 2008', type: 'Floods', region: 'North Bihar', severity: 4, start_date: '2008-08-18', end_date: '' },
  { event_id: 9, name: 'Uttarakhand Floods & Landslides 2013', type: 'Floods', region: 'Uttarakhand and Himachal Pradesh', severity: 5, start_date: '2013-06-16', end_date: '' },
  { event_id: 10, name: 'Cyclone Phailin 2013', type: 'Cyclone', region: 'Odisha and Andhra Pradesh', severity: 2, start_date: '2013-10-12', end_date: '' },
  { event_id: 11, name: 'Cyclone Hudhud 2014', type: 'Cyclone', region: 'Andhra Pradesh & Odisha', severity: 3, start_date: '2014-10-12', end_date: '' },
  { event_id: 12, name: 'Kerala Floods 2018', type: 'Floods and Heavy Rains', region: 'Kerala', severity: 5, start_date: '2018-08-08', end_date: '' },
  { event_id: 13, name: 'Bihar, Maharashtra & Kerala Floods 2019', type: 'Floods and Heavy Rains', region: 'Bihar, Maharashtra and Kerala', severity: 3, start_date: '2019-01-01', end_date: '' },
  { event_id: 14, name: 'Cauvery Flood 2026 (fabricated)', type: 'flood', region: 'Tamil Nadu', severity: 4, start_date: '2026-08-01', end_date: '' },
  { event_id: 15, name: 'Nilgiris Landslide 2026 (fabricated)', type: 'landslide', region: 'Tamil Nadu', severity: 3, start_date: '2026-08-10', end_date: '' },
];

const users = [
  { user_id: 1, name: 'Fixture Admin', phone: 'TEST-USER-0001', email: 'admin@example.invalid', password_hash: 'FIXTURE_ONLY_NOT_A_BCRYPT_HASH', role: 'Admin' },
  { user_id: 2, name: 'Fixture Coordinator 1', phone: 'TEST-USER-0002', email: 'coordinator1@example.invalid', password_hash: 'FIXTURE_ONLY_NOT_A_BCRYPT_HASH', role: 'ShelterCoordinator' },
  { user_id: 3, name: 'Fixture Coordinator 2', phone: 'TEST-USER-0003', email: 'coordinator2@example.invalid', password_hash: 'FIXTURE_ONLY_NOT_A_BCRYPT_HASH', role: 'ShelterCoordinator' },
  { user_id: 4, name: 'Fixture Volunteer 1', phone: 'TEST-USER-0004', email: 'volunteer1@example.invalid', password_hash: 'FIXTURE_ONLY_NOT_A_BCRYPT_HASH', role: 'Volunteer' },
];
for (let id = 5; id <= 104; id++) {
  users.push({
    user_id: id,
    name: `Synthetic Volunteer User ${pad(id - 4, 3)}`,
    phone: `TEST-USER-${pad(id)}`,
    email: `volunteer${pad(id, 3)}@example.invalid`,
    password_hash: 'FIXTURE_ONLY_NOT_A_BCRYPT_HASH',
    role: 'Volunteer',
  });
}

const shelters = [
  { shelter_id: 1, event_id: 12, name: 'Kalady Ashram School Relief Camp', address: 'Kalady, Ernakulam district, Kerala', latitude: 10.1667, longitude: 76.4333, capacity_total: 3000, capacity_occupied: 2800, contact_number: '', coordinator_id: 2, status: 'active' },
  { shelter_id: 2, event_id: 12, name: 'Ernakulam District Relief Camps (aggregate, 64 camps)', address: 'Ernakulam district, Kerala', latitude: 9.9816, longitude: 76.2999, capacity_total: 9500, capacity_occupied: 9000, contact_number: '', coordinator_id: 3, status: 'active' },
  { shelter_id: 3, event_id: 12, name: 'Idukki District Relief Camps (aggregate)', address: 'Idukki district, Kerala', latitude: 9.8534, longitude: 76.9628, capacity_total: 3700, capacity_occupied: 3521, contact_number: '', coordinator_id: 3, status: 'active' },
  { shelter_id: 4, event_id: 12, name: 'Wayanad District Relief Camps (aggregate, 87 camps)', address: 'Wayanad district, Kerala', latitude: 11.6085, longitude: 76.0851, capacity_total: 6400, capacity_occupied: 6111, contact_number: '', coordinator_id: 2, status: 'active' },
  { shelter_id: 5, event_id: 12, name: 'Alappuzha District Relief Camps (aggregate)', address: 'Alappuzha district, Kerala', latitude: 9.4981, longitude: 76.3388, capacity_total: 125000, capacity_occupied: 118000, contact_number: '', coordinator_id: 3, status: 'active' },
  { shelter_id: 6, event_id: 14, name: 'Government High School Shelter (fabricated)', address: 'Trichy Rd, Trichy (fabricated)', latitude: 10.7905, longitude: 78.7047, capacity_total: 3, capacity_occupied: 0, contact_number: '', coordinator_id: 2, status: 'active' },
  { shelter_id: 7, event_id: 14, name: 'Community Hall Shelter (fabricated)', address: 'Anna Nagar, Trichy (fabricated)', latitude: 10.8020, longitude: 78.6900, capacity_total: 50, capacity_occupied: 12, contact_number: '', coordinator_id: 3, status: 'active' },
  { shelter_id: 8, event_id: 15, name: 'Nilgiris Relief Camp (fabricated)', address: 'Ooty Rd, Coonoor (fabricated)', latitude: 11.3500, longitude: 76.8000, capacity_total: 30, capacity_occupied: 5, contact_number: '', coordinator_id: 3, status: 'active' },
];

const districts = [
  { district: 'Thiruvananthapuram', camps: 114, people: 8514, latitude: 8.5241, longitude: 76.9366 },
  { district: 'Kollam', camps: 121, people: 20618, latitude: 8.8932, longitude: 76.6141 },
  { district: 'Pathanamthitta', camps: 307, people: 31784, latitude: 9.2648, longitude: 76.7870 },
  { district: 'Alappuzha', camps: 695, people: 249661, latitude: 9.4981, longitude: 76.3388 },
  { district: 'Kottayam', camps: 359, people: 62415, latitude: 9.5916, longitude: 76.5222 },
  { district: 'Idukki', camps: 242, people: 32119, latitude: 9.8534, longitude: 76.9628 },
  { district: 'Ernakulam', camps: 544, people: 123575, latitude: 9.9816, longitude: 76.2999 },
  { district: 'Thrissur', camps: 648, people: 102950, latitude: 10.5276, longitude: 76.2144 },
  { district: 'Palakkad', camps: 98, people: 10122, latitude: 10.7867, longitude: 76.6548 },
  { district: 'Malappuram', camps: 301, people: 37964, latitude: 11.0510, longitude: 76.0711 },
  { district: 'Kozhikode', camps: 328, people: 31076, latitude: 11.2588, longitude: 75.7804 },
  { district: 'Wayanad', camps: 261, people: 6952, latitude: 11.6085, longitude: 76.0851 },
  { district: 'Kannur', camps: 14, people: 1227, latitude: 11.8745, longitude: 75.3704 },
  { district: 'Kasaragod', camps: 1, people: 251, latitude: 12.4996, longitude: 74.9869 },
];
for (const [index, district] of districts.entries()) {
  const shelterId = shelters.length + 1;
  shelters.push({
    shelter_id: shelterId,
    event_id: 12,
    name: `2018-08-20 ${district.district} district aggregate (${district.camps} camps)`,
    address: `${district.district} district, Kerala; administrative-center approximation`,
    latitude: district.latitude,
    longitude: district.longitude,
    capacity_total: Math.ceil(district.people * 1.05),
    capacity_occupied: district.people,
    contact_number: '',
    coordinator_id: null,
    status: 'historical_snapshot',
  });
}

for (let index = 0; index < 32; index++) {
  const shelterId = shelters.length + 1;
  const eventId = index < 16 ? 14 : 15;
  const anchor = eventId === 14 ? { latitude: 10.7905, longitude: 78.7047 } : { latitude: 11.3500, longitude: 76.8000 };
  const capacity = index === 0 ? 12 : 500 + randomInt(1500);
  const occupied = index === 0 ? 4 : randomInt(Math.max(1, Math.floor(capacity * 0.9)));
  shelters.push({
    shelter_id: shelterId,
    event_id: eventId,
    name: `Synthetic Test Shelter ${pad(index + 1, 3)}`,
    address: `Synthetic location ${pad(index + 1, 3)}`,
    latitude: Number((anchor.latitude + (index % 8) * 0.012).toFixed(6)),
    longitude: Number((anchor.longitude + Math.floor(index / 8) * 0.014).toFixed(6)),
    capacity_total: capacity,
    capacity_occupied: occupied,
    contact_number: '',
    coordinator_id: 2 + (index % 2),
    status: 'active',
  });
}

const categories = [
  { category_id: 1, name: 'Food' },
  { category_id: 2, name: 'Water' },
  { category_id: 3, name: 'Medical' },
  { category_id: 4, name: 'Bedding' },
  { category_id: 5, name: 'Hygiene' },
  { category_id: 6, name: 'Rescue' },
  { category_id: 7, name: 'Clothing' },
  { category_id: 8, name: 'Power' },
];

const supplies = [
  { supply_id: 1, shelter_id: 1, category_id: 1, item_name: 'Rice packets', quantity: 400, unit: 'packets', reorder_threshold: 100 },
  { supply_id: 2, shelter_id: 1, category_id: 2, item_name: 'Water bottles', quantity: 80, unit: 'bottles', reorder_threshold: 150 },
  { supply_id: 3, shelter_id: 2, category_id: 1, item_name: 'Rice packets', quantity: 1200, unit: 'packets', reorder_threshold: 300 },
  { supply_id: 4, shelter_id: 2, category_id: 3, item_name: 'First aid kits', quantity: 60, unit: 'kits', reorder_threshold: 20 },
  { supply_id: 5, shelter_id: 4, category_id: 4, item_name: 'Blankets', quantity: 500, unit: 'pieces', reorder_threshold: 150 },
];
const syntheticSupplies = [];
for (const shelter of shelters.filter(row => row.shelter_id >= 23)) {
  for (const category of categories.slice(0, 5)) {
    const id = supplies.length + 1;
    const isAllocationFixture = shelter.shelter_id === 23 && category.category_id === 2;
    const initialQuantity = isAllocationFixture ? 100 : 500 + randomInt(501);
    const row = {
      supply_id: id,
      shelter_id: shelter.shelter_id,
      category_id: category.category_id,
      item_name: `${category.name} test stock ${pad(shelter.shelter_id, 3)}`,
      quantity: initialQuantity,
      unit: category.category_id === 1 ? 'packs' : category.category_id === 2 ? 'cases' : 'units',
      reorder_threshold: isAllocationFixture ? 100 : 50 + randomInt(100),
    };
    supplies.push(row);
    syntheticSupplies.push({ row, initialQuantity });
  }
}

const volunteers = [{ volunteer_id: 1, user_id: 4, skills: 'First aid, logistics', availability: 'weekends' }];
for (let id = 2; id <= 101; id++) {
  volunteers.push({ volunteer_id: id, user_id: id + 3, skills: ['First aid', 'Logistics', 'Medical support', 'Distribution'][randomInt(4)], availability: ['weekdays', 'weekends', 'evenings', 'flexible'][randomInt(4)] });
}

const tasks = [
  { task_id: 1, shelter_id: 1, volunteer_id: 1, parent_task_id: '', description: 'Set up medical tent', status: 'in_progress', priority: 1 },
  { task_id: 2, shelter_id: 1, volunteer_id: 1, parent_task_id: 1, description: 'Stock medical tent with first aid kits', status: 'pending', priority: 2 },
  { task_id: 3, shelter_id: 1, volunteer_id: 1, parent_task_id: 1, description: 'Assign a volunteer to staff the tent', status: 'pending', priority: 2 },
];
let nextTaskId = 4;
for (const shelter of shelters.filter(row => row.shelter_id >= 23)) {
  const parentTaskId = nextTaskId;
  for (let child = 0; child < 10; child++) {
    const taskId = nextTaskId++;
    tasks.push({
      task_id: taskId,
      shelter_id: shelter.shelter_id,
      volunteer_id: 1 + (taskId % volunteers.length),
      parent_task_id: child === 0 ? '' : parentTaskId,
      description: child === 0 ? `Synthetic task group ${pad(shelter.shelter_id, 3)}` : `Synthetic task ${child} for shelter ${pad(shelter.shelter_id, 3)}`,
      status: child === 0 ? 'in_progress' : ['pending', 'completed', 'pending', 'in_progress'][randomInt(4)],
      priority: 1 + randomInt(5),
    });
  }
}

const requestTypes = ['shelter', 'food', 'water', 'medical', 'rescue'];
const aidRequests = [
  { request_id: 1, event_id: 12, requester_name: 'Requester A (fabricated identity)', phone: 'TEST-REQ-000001', latitude: 10.1075, longitude: 76.3516, request_type: 'rescue', num_people: 4, urgency_level: 5, status: 'pending', created_at: '2026-10-01 08:00:00' },
  { request_id: 2, event_id: 12, requester_name: 'Requester B (fabricated identity)', phone: 'TEST-REQ-000002', latitude: 9.3167, longitude: 76.6167, request_type: 'rescue', num_people: 6, urgency_level: 5, status: 'pending', created_at: '2026-10-01 08:10:00' },
  { request_id: 3, event_id: 12, requester_name: 'Requester C (fabricated identity)', phone: 'TEST-REQ-000003', latitude: 9.2333, longitude: 76.6833, request_type: 'food', num_people: 5, urgency_level: 3, status: 'pending', created_at: '2026-10-01 08:20:00' },
  { request_id: 4, event_id: 12, requester_name: 'Requester D (fabricated identity)', phone: 'TEST-REQ-000004', latitude: 11.2833, longitude: 76.2667, request_type: 'shelter', num_people: 5, urgency_level: 4, status: 'pending', created_at: '2026-10-01 08:30:00' },
  { request_id: 5, event_id: 12, requester_name: 'Requester E (fabricated identity)', phone: 'TEST-REQ-000005', latitude: 9.3833, longitude: 76.7500, request_type: 'water', num_people: 3, urgency_level: 3, status: 'pending', created_at: '2026-10-01 08:40:00' },
  { request_id: 6, event_id: 14, requester_name: 'Synthetic requester 000006', phone: 'TEST-REQ-000006', latitude: 10.7910, longitude: 78.7050, request_type: 'shelter', num_people: 2, urgency_level: 5, status: 'pending', created_at: '2026-10-01 08:50:00' },
  { request_id: 7, event_id: 14, requester_name: 'Synthetic requester 000007', phone: 'TEST-REQ-000007', latitude: 10.8000, longitude: 78.6890, request_type: 'shelter', num_people: 4, urgency_level: 3, status: 'pending', created_at: '2026-10-01 09:00:00' },
  { request_id: 8, event_id: 15, requester_name: 'Synthetic requester 000008', phone: 'TEST-REQ-000008', latitude: 11.3480, longitude: 76.7990, request_type: 'medical', num_people: 1, urgency_level: 4, status: 'pending', created_at: '2026-10-01 09:10:00' },
];
const syntheticShelters = shelters.filter(row => row.shelter_id >= 23);
// Keep request IDs 2009/2010 available for the documented allocation scenarios.
const syntheticRequestCount = 2500;
const allocatedRequestCount = 500;
const capacityLogCount = 2500;
const requestsStart = Date.UTC(2026, 9, 1, 0, 0, 0);
for (let index = 0; index < syntheticRequestCount; index++) {
  const requestId = aidRequests.length + 1;
  const shelter = syntheticShelters[index % syntheticShelters.length];
  const createdAt = new Date(requestsStart + index * 90000).toISOString().replace('T', ' ').slice(0, 19);
  aidRequests.push({
    request_id: requestId,
    event_id: shelter.event_id,
    requester_name: `Synthetic requester ${pad(requestId, 6)}`,
    phone: `TEST-REQ-${pad(requestId, 6)}`,
    latitude: Number((shelter.latitude + ((index % 5) - 2) * 0.0005).toFixed(6)),
    longitude: Number((shelter.longitude + ((index % 7) - 3) * 0.0005).toFixed(6)),
    request_type: requestTypes[randomInt(requestTypes.length)],
    num_people: 1 + randomInt(10),
    urgency_level: 1 + randomInt(5),
    status: index < allocatedRequestCount ? 'fulfilled' : 'pending',
    created_at: createdAt,
  });
}

const allocations = [];
for (let index = 0; index < allocatedRequestCount; index++) {
  const supply = syntheticSupplies[(index * 17) % syntheticSupplies.length];
  const quantity = 1 + randomInt(5);
  supply.row.quantity -= quantity;
  allocations.push({
    allocation_id: index + 1,
    request_id: index + 9,
    supply_id: supply.row.supply_id,
    quantity_allocated: quantity,
    allocated_at: new Date(requestsStart + index * 60000).toISOString().replace('T', ' ').slice(0, 19),
  });
}

const capacityLogs = [];
const loggedShelters = shelters.filter(row => row.shelter_id <= 8 || row.shelter_id >= 23);
const logsStart = Date.UTC(2026, 8, 16, 0, 0, 0);
for (let index = 0; index < capacityLogCount; index++) {
  const shelter = loggedShelters[index % loggedShelters.length];
  capacityLogs.push({
    log_id: index + 1,
    shelter_id: shelter.shelter_id,
    capacity_occupied: randomInt(shelter.capacity_total + 1),
    logged_at: new Date(logsStart + index * 250000).toISOString().replace('T', ' ').slice(0, 19),
  });
}

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const ids = (rows, key) => new Set(rows.map(row => row[key]));
assert(districts.reduce((sum, row) => sum + row.camps, 0) === 4033, 'Government district camp counts do not sum to 4,033.');
assert(districts.reduce((sum, row) => sum + row.people, 0) === 719228, 'Government district occupancy counts do not sum to 719,228.');
assert(new Set(users.map(row => row.phone)).size === users.length, 'Fixture user phone identifiers must be unique.');
assert(shelters.length === 54, 'Expected 54 shelter rows.');
assert(aidRequests.length === 8 + syntheticRequestCount, `Expected ${8 + syntheticRequestCount} aid-request rows.`);
assert(allocations.length === allocatedRequestCount, `Expected ${allocatedRequestCount} allocation rows.`);
assert(capacityLogs.length === capacityLogCount, `Expected ${capacityLogCount} capacity-log rows.`);
assert(capacityLogs.every(row => ids(shelters, 'shelter_id').has(row.shelter_id) && row.capacity_occupied <= shelters.find(s => s.shelter_id === row.shelter_id).capacity_total), 'Capacity log contains an invalid shelter or occupancy.');
assert(shelters.every(row => ids(events, 'event_id').has(row.event_id) && (row.coordinator_id === null || ids(users, 'user_id').has(row.coordinator_id)) && row.capacity_occupied <= row.capacity_total), 'Shelter rows contain an invalid foreign key or capacity.');
assert(supplies.every(row => row.quantity >= 0 && ids(shelters, 'shelter_id').has(row.shelter_id) && ids(categories, 'category_id').has(row.category_id)), 'Supply rows contain an invalid foreign key or negative stock.');
assert(volunteers.every(row => ids(users, 'user_id').has(row.user_id)), 'Volunteer rows contain an invalid user.');
assert(tasks.every(row => ids(shelters, 'shelter_id').has(row.shelter_id) && ids(volunteers, 'volunteer_id').has(row.volunteer_id) && (!row.parent_task_id || row.parent_task_id < row.task_id)), 'Task hierarchy contains an invalid reference or cycle.');
assert(aidRequests.every(row => ids(events, 'event_id').has(row.event_id) && row.num_people > 0 && row.urgency_level >= 1 && row.urgency_level <= 5), 'Aid request rows contain an invalid event or check value.');
assert(allocations.every(row => ids(aidRequests, 'request_id').has(row.request_id) && ids(supplies, 'supply_id').has(row.supply_id) && aidRequests[row.request_id - 1].status === 'fulfilled'), 'Allocation rows contain an invalid request or supply.');

const tableFiles = [
  ['01_disaster_events.csv', ['event_id', 'name', 'type', 'region', 'severity', 'start_date', 'end_date'], events],
  ['02_users.csv', ['user_id', 'name', 'phone', 'email', 'password_hash', 'role'], users],
  ['03_shelters.csv', ['shelter_id', 'event_id', 'name', 'address', 'latitude', 'longitude', 'capacity_total', 'capacity_occupied', 'contact_number', 'coordinator_id', 'status'], shelters],
  ['04_shelter_capacity_log.csv', ['log_id', 'shelter_id', 'capacity_occupied', 'logged_at'], capacityLogs],
  ['05_supply_categories.csv', ['category_id', 'name'], categories],
  ['06_supplies.csv', ['supply_id', 'shelter_id', 'category_id', 'item_name', 'quantity', 'unit', 'reorder_threshold'], supplies],
  ['07_volunteers.csv', ['volunteer_id', 'user_id', 'skills', 'availability'], volunteers],
  ['08_volunteer_tasks.csv', ['task_id', 'shelter_id', 'volunteer_id', 'parent_task_id', 'description', 'status', 'priority'], tasks],
  ['09_aid_requests.csv', ['request_id', 'event_id', 'requester_name', 'phone', 'latitude', 'longitude', 'request_type', 'num_people', 'urgency_level', 'status', 'created_at'], aidRequests],
  ['10_allocations.csv', ['allocation_id', 'request_id', 'supply_id', 'quantity_allocated', 'allocated_at'], allocations],
];
for (const [file, columns, rows] of tableFiles) writeCsv(path.join(postgresDir, file), columns, rows);

writeCsv(path.join(sourceDir, 'kerala_2018-08-20_district_camps.csv'), ['snapshot_date', 'district', 'relief_camp_count', 'people_in_camps'], districts.map(row => ({ snapshot_date: '2018-08-20', district: row.district, relief_camp_count: row.camps, people_in_camps: row.people })));

const counts = tableFiles.map(([file, , rows]) => ({ file: `postgres/${file}`, row_count: rows.length, source_class: file.startsWith('01_') ? 'mixed: sourced plus fabricated events' : file.startsWith('03_') ? 'mixed: sourced snapshot plus synthetic shelters' : 'synthetic operational fixtures', load_order: Number(file.slice(0, 2)) }));
counts.push({ file: 'source_snapshots/kerala_2018-08-20_district_camps.csv', row_count: districts.length, source_class: 'official public-table extract; source page cited in README', load_order: '' });
writeCsv(path.join(metadataDir, 'dataset_catalog.csv'), ['file', 'row_count', 'source_class', 'load_order'], counts);

const sources = [
  { source_id: 'SRC-001', publisher: 'Central Statistics Office / MoSPI, Government of India', title: 'EnviStats India 2020, Table 1.9 — India major natural disasters since 1990', source_url: 'https://iasri.res.in/agridata/23data/chapter1/db2020tb1_9.pdf', license_or_terms: 'Government publication; reuse terms not independently established here', local_status: '13 source-grounded event rows represented in postgres/01_disaster_events.csv; source PDF not bundled', notes: 'See database/DATA_SOURCES.md for fields that are editorial, derived, or taken from a second source.' },
  { source_id: 'SRC-002', publisher: 'Local Self Government Department, Government of Kerala', title: 'Flood relief camp details as on 20 August 2018', source_url: 'https://lsgkerala.gov.in/en/flood-relief/camps-20august2018', license_or_terms: 'Government web page; no explicit dataset license asserted', local_status: '14-district fact extract included at source_snapshots/kerala_2018-08-20_district_camps.csv', notes: 'Reported camp counts and occupants only; this is a dated district snapshot, not current live shelter capacity.' },
  { source_id: 'SRC-003', publisher: 'Robert Munro', title: 'Disaster Response Messages (25,000 messages)', source_url: 'https://github.com/rmunro/disaster_response_messages', license_or_terms: 'CC BY 4.0, as stated by the dataset author', local_status: 'Not present in this workspace; local shell network access to raw file host was unavailable', notes: 'Author describes PII removal and prohibits combining records to reveal identities. Keep separate from ReliefGrid table imports; available as three training/validation/test CSV files.' },
];
writeCsv(path.join(metadataDir, 'external_sources.csv'), ['source_id', 'publisher', 'title', 'source_url', 'license_or_terms', 'local_status', 'notes'], sources);
const externalFiles = ['training', 'validation', 'test'].map(split => ({
  source_id: 'SRC-003',
  filename: `disaster_response_${split}.csv`,
  source_url: `https://github.com/rmunro/disaster_response_messages/blob/main/disaster_response_${split}.csv`,
  intended_use: 'Separate message-classification research corpus; not a ReliefGrid PostgreSQL table import',
  local_status: 'Not downloaded; add the author-provided CSV to external/disaster_response_messages/',
}));
writeCsv(path.join(metadataDir, 'external_files.csv'), ['source_id', 'filename', 'source_url', 'intended_use', 'local_status'], externalFiles);

const provenance = [
  { table_name: 'Disaster_Events', id_from: 1, id_to: 13, classification: 'source-grounded; some columns derived/editorial', source_url: 'https://iasri.res.in/agridata/23data/chapter1/db2020tb1_9.pdf', notes: '13 historical rows based on the seed dataset; severity buckets and selected dates are editorial/derived as documented in database/DATA_SOURCES.md. Kerala death toll comes from the separately cited KSMDA assessment.' },
  { table_name: 'Disaster_Events', id_from: 14, id_to: 15, classification: 'FABRICATED', source_url: '', notes: 'Synthetic events retained from seed.sql to exercise cross-event queries.' },
  { table_name: 'Shelters', id_from: 1, id_to: 5, classification: 'reported headcounts with derived/fabricated fields', source_url: 'https://imedia.chennaimath.org/blogs/post/kerala-flood-relief-2018; https://actalliance.org/?p=8994; https://www.thenewsminute.com/article/kerala-floods-1000s-relief-camps-schools-colleges-stay-shut-most-districts-106879; https://www.easternmirrornagaland.com/rains-abate-flood-waters-recede-as-relief-pours-into-kerala', notes: 'Reported headcounts are source-grounded; total capacity includes a disclosed buffer; coordinates are approximate; contact numbers omitted.' },
  { table_name: 'Shelters', id_from: 6, id_to: 8, classification: 'FABRICATED', source_url: '', notes: 'Small operational rows retained from seed.sql for nearest-shelter and concurrency demos.' },
  { table_name: 'Shelters', id_from: 9, id_to: 22, classification: 'source snapshot plus derived/fabricated fields', source_url: 'https://lsgkerala.gov.in/en/flood-relief/camps-20august2018', notes: 'Government-reported district camps and occupants as of 2018-08-20. Each row is a district aggregate, not a physical shelter. Capacity buffer, administrative-center coordinates, and status are modeling choices. Kept historical_snapshot so live shelter matching excludes these rows.' },
  { table_name: 'Shelters', id_from: 23, id_to: 54, classification: 'FABRICATED', source_url: '', notes: 'Synthetic test shelters with fictional coordinates/contacts omitted; event 14/15; shelter 23 is a small transaction fixture.' },
  { table_name: 'Users', id_from: 1, id_to: 104, classification: 'FABRICATED', source_url: '', notes: 'Fictional test-only records. Phone values use TEST-USER identifiers; password_hash is an invalid non-secret fixture marker, so these rows cannot authenticate.' },
  { table_name: 'Shelter_Capacity_Log', id_from: 1, id_to: capacityLogCount, classification: 'FABRICATED', source_url: '', notes: 'Deterministic synthetic snapshots for trend and scale tests; not historical observations.' },
  { table_name: 'Supply_Categories', id_from: 1, id_to: 8, classification: 'FABRICATED', source_url: '', notes: 'Operational categories for exercising the inventory schema.' },
  { table_name: 'Supplies', id_from: 1, id_to: 165, classification: 'FABRICATED', source_url: '', notes: `Stock values are simulation inputs. Allocated amounts have already been deducted from the ${allocatedRequestCount} recorded synthetic allocation rows.` },
  { table_name: 'Volunteers', id_from: 1, id_to: 101, classification: 'FABRICATED', source_url: '', notes: 'Fictional test users only.' },
  { table_name: 'Volunteer_Tasks', id_from: 1, id_to: 323, classification: 'FABRICATED', source_url: '', notes: 'Fictional hierarchy; synthetic parent IDs always refer to an earlier task.' },
  { table_name: 'Aid_Requests', id_from: 1, id_to: 5, classification: 'real place/need context; fabricated request records', source_url: 'https://www.deccanherald.com/amp/story/india%2Fkerala-toll-mounts-to-29-over-53000-in-relief-camps-686511.html; https://www.easternmirrornagaland.com/rains-abate-flood-waters-recede-as-relief-pours-into-kerala; https://www.thenewsminute.com/article/kerala-floods-1000s-relief-camps-schools-colleges-stay-shut-most-districts-106879', notes: 'Localities and need types are grounded in reporting; requester identity, phone, count, urgency and exact coordinates are fictional.' },
  { table_name: 'Aid_Requests', id_from: 6, id_to: 8 + syntheticRequestCount, classification: 'FABRICATED', source_url: '', notes: `Generated with fixed seed 20261016. Requests 9-${8 + allocatedRequestCount} are fulfilled and have matching allocation records; requests ${9 + allocatedRequestCount}-${8 + syntheticRequestCount} remain pending.` },
  { table_name: 'Allocations', id_from: 1, id_to: allocatedRequestCount, classification: 'FABRICATED', source_url: '', notes: 'Synthetic transaction history; stock CSV values are post-allocation balances.' },
];
writeCsv(path.join(metadataDir, 'record_provenance.csv'), ['table_name', 'id_from', 'id_to', 'classification', 'source_url', 'notes'], provenance);

const scenarios = [
  { scenario_id: 'checkin_success', operation: 'checkin_to_shelter', target_id: 6, inputs: 'p_num_people=2', expected: 'TRUE; capacity_occupied becomes 2', reset: 'Reload the disposable fixture before each scenario; shelter 6 starts at 0/3.' },
  { scenario_id: 'checkin_rejects_over_capacity', operation: 'checkin_to_shelter', target_id: 6, inputs: 'p_num_people=4', expected: 'FALSE; occupancy remains 0', reset: 'Reload the disposable fixture before each scenario.' },
  { scenario_id: 'concurrent_checkin_demo', operation: 'server/tests/concurrency-test.js', target_id: 6, inputs: '5 concurrent requests x 2 people', expected: 'One succeeds and four receive 409; final occupancy is 2/3', reset: 'Run only on a freshly loaded disposable DB; set TEST_SHELTER_ID=6.' },
  { scenario_id: 'nearest_shelters', operation: 'find_nearest_shelters', target_id: 1, inputs: 'in_lat=10.1075;in_lon=76.3516;req_space=2;max_results=5', expected: 'Returns available active shelters ordered by distance', reset: 'No reset needed.' },
  { scenario_id: 'priority_queue', operation: 'get_priority_queue', target_id: '', inputs: 'No arguments', expected: `Returns ${8 + syntheticRequestCount - allocatedRequestCount} pending requests before mutations`, reset: 'Reload fixture after allocating or changing requests.' },
  { scenario_id: 'shortage_view', operation: 'Critical_Supply_Shortage', target_id: 2, inputs: 'SELECT * WHERE supply_id=2', expected: 'Water bottles row is below its reorder threshold', reset: 'No reset needed.' },
  { scenario_id: 'allocation_success', operation: 'allocate_supply', target_id: 2009, inputs: 'p_request_id=2009;p_supply_id=7;p_qty=2', expected: 'TRUE; stock decreases, allocation row is inserted, request becomes fulfilled', reset: 'Reload fixture before each run; initial request 2009 is pending.' },
  { scenario_id: 'allocation_insufficient_stock', operation: 'allocate_supply', target_id: 2010, inputs: 'p_request_id=2010;p_supply_id=7;p_qty=999999', expected: 'FALSE; request, stock, and allocation rows remain unchanged', reset: 'Reload fixture before each run; initial request 2010 is pending.' },
  { scenario_id: 'capacity_trend', operation: 'mv_daily_capacity_trend', target_id: '', inputs: 'REFRESH MATERIALIZED VIEW, then SELECT', expected: 'Daily peaks are available for synthetic log rows', reset: 'No reset needed.' },
  { scenario_id: 'isolation_demo', operation: 'server/tests/isolation-level-test.js', target_id: 1, inputs: 'Default TEST_SHELTER_ID=1', expected: 'READ COMMITTED and SERIALIZABLE outcomes can be compared', reset: 'Only disposable DB; script resets occupancy on shelter 1.' },
  { scenario_id: 'deadlock_demo', operation: 'server/tests/deadlock-test.js', target_id: '1,2', inputs: 'Default TEST_SHELTER_LOW=1;TEST_SHELTER_HIGH=2', expected: 'One transaction reports SQLSTATE 40P01', reset: 'Only disposable DB; script changes occupancy on shelters 1 and 2.' },
];
writeCsv(path.join(metadataDir, 'simulation_scenarios.csv'), ['scenario_id', 'operation', 'target_id', 'inputs', 'expected', 'reset'], scenarios);

console.log(`Generated ${tableFiles.length} PostgreSQL table CSVs: ${tableFiles.map(([file, , rows]) => `${file}=${rows.length}`).join(', ')}`);
