package plugins

import (
	ac "github.com/grafana/grafana/pkg/services/accesscontrol"
	"github.com/grafana/grafana/pkg/services/org"
)

const (
	ActionAppAccess    = "plugins.app:access"
	ActionPluginsWrite = "plugins:write"
	// FIXME: have uninstall action?
	ActionPluginsInstall = "plugins:install"
)

var (
	ScopeProvider = ac.NewScopeProvider("plugins")
)

func DeclareRBACRoles(acService ac.AccessControl) error {
	AppPluginsReader := ac.RoleRegistration{
		Role: ac.RoleDTO{
			Name:        ac.FixedRolePrefix + "plugins.app:reader",
			DisplayName: "Application Plugins Access",
			Description: "Access application plugins (still enforcing the organization role)",
			Group:       "Plugins",
			Permissions: []ac.Permission{
				{Action: ActionAppAccess, Scope: ScopeProvider.GetResourceAllScope()},
			},
		},
		Grants: []string{string(org.RoleViewer)},
	}

	PluginsWriter := ac.RoleRegistration{
		Role: ac.RoleDTO{
			Name:        ac.FixedRolePrefix + "plugins:writer",
			DisplayName: "Plugins Writer",
			Description: "Update plugin settings",
			Group:       "Plugins",
			Permissions: []ac.Permission{
				{Action: ActionPluginsWrite, Scope: ScopeProvider.GetResourceAllScope()},
			},
		},
		Grants: []string{ac.RoleGrafanaAdmin, string(org.RoleAdmin)},
	}

	PluginsInstaller := ac.RoleRegistration{
		Role: ac.RoleDTO{
			Name:        ac.FixedRolePrefix + "plugins:installer",
			DisplayName: "Plugins Installer",
			// FIXME update description with new actions
			Description: "Install plugins",
			Group:       "Plugins",
			Permissions: ac.ConcatPermissions(PluginsWriter.Role.Permissions, []ac.Permission{
				{Action: ActionPluginsInstall, Scope: ScopeProvider.GetResourceAllScope()},
			}),
		},
		Grants: []string{ac.RoleGrafanaAdmin},
	}

	return acService.DeclareFixedRoles(AppPluginsReader, PluginsWriter, PluginsInstaller)
}
