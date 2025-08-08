-- Create the missing generate_route_name function
CREATE OR REPLACE FUNCTION public.generate_route_name(route_edges integer[], route_shape text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Simple route name generation
    RETURN 'Route - ' || route_shape || ' (' || array_length(route_edges, 1) || ' segments)';
END;
$function$; 