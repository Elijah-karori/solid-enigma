package rbac

import "testing"

func TestMatrix(t *testing.T) {
	cases := []struct {
		role, perm string
		want       bool
	}{
		{Admin, "manageUsers", true},
		{Technician, "manageUsers", false},
		{Finance, "viewCosts", true},
		{StoreManager, "viewCosts", false}, // costs are Admin/Finance only
		{Technician, "requestMaterial", true},
		{Support, "moveStock", false},
		{ProjectManager, "approveFinance", false},
		{"Nobody", "viewDashboard", false}, // unknown roles denied
		{Admin, "doesNotExist", false},     // unknown permissions denied
	}
	for _, c := range cases {
		if got := Can(c.role, c.perm); got != c.want {
			t.Errorf("Can(%q,%q)=%v want %v", c.role, c.perm, got, c.want)
		}
	}
}
