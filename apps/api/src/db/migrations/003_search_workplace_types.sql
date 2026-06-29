UPDATE searches
SET query = jsonb_set(query, '{workplaceTypes}', '[]'::jsonb, true)
WHERE NOT query ? 'workplaceTypes';
