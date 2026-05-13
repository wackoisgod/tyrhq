export type DeployAxis = 'x' | 'y' | 'z';

export type DeployJoint = {
	jointName: string;
	axis: DeployAxis;
	angleDeg: number;
};

export type VehicleDeploySpec = {
	label: string;
	deployedLabel: string;
	stowedLabel: string;
	durationMs: number;
	joints: DeployJoint[];
};

const VEHICLE_DEPLOY_SPECS: Record<string, VehicleDeploySpec> = {
	vtol: {
		label: 'Wings',
		deployedLabel: 'Wings Deployed',
		stowedLabel: 'Wings Stowed',
		durationMs: 650,
		joints: [
			{ jointName: 'jnt_wing_l', axis: 'x', angleDeg: 75 },
			{ jointName: 'jnt_wing_r', axis: 'x', angleDeg: -75 }
		]
	}
};

export function getVehicleDeploySpec(vehicleId: string): VehicleDeploySpec | null {
	return VEHICLE_DEPLOY_SPECS[vehicleId] ?? null;
}
