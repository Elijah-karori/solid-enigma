package auth

import "testing"

func TestValidatePassword(t *testing.T) {
	bad := []string{"short1", "alllettersonly", "1234567890123", "a1" + string(make([]byte, 80))}
	for _, p := range bad {
		if ValidatePassword(p, "x@y.com") == nil {
			t.Errorf("expected %q to be rejected", p)
		}
	}
	if err := ValidatePassword("correct-horse-42", "x@y.com"); err != nil {
		t.Errorf("good password rejected: %v", err)
	}
}
