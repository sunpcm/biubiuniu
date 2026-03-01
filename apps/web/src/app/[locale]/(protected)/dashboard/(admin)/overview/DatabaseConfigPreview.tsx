import { Badge } from "@niu/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@niu/ui/card";
import { previewConfig } from "@niu/db/config";
import { Database, Globe, Link as LinkIcon, Server, ShieldCheck, Zap } from "lucide-react";

export const DatabaseConfigPreview = () => {
  if (!process.env.DATABASE_URL) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Database Configuration</CardTitle>
          <CardDescription>DATABASE_URL environment variable is not set.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const configPreview = previewConfig({
    connectionString: process.env.DATABASE_URL,
  });

  const { platform, database, summary } = configPreview;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Environment Status</CardTitle>
        <CardDescription>Auto-detected configuration for the current deployment.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-3">
        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <Globe className="h-4 w-4" />
            <span>Deployment Platform</span>
          </div>
          <Badge variant="outline" className="w-fit font-mono capitalize">
            {platform}
          </Badge>
        </div>

        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <Database className="h-4 w-4" />
            <span>Database Provider</span>
          </div>
          <Badge variant="outline" className="w-fit font-mono capitalize">
            {database}
          </Badge>
        </div>

        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <Server className="h-4 w-4" />
            <span>Environment Type</span>
          </div>
          {summary.isServerless ? (
            <Badge variant="secondary" className="w-fit">
              Serverless
            </Badge>
          ) : (
            <Badge variant="default" className="w-fit">
              Server
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <LinkIcon className="h-4 w-4" />
            <span>Connection Pooling</span>
          </div>
          {summary.connectionPooling ? (
            <Badge variant="default" className="w-fit">
              Enabled
            </Badge>
          ) : (
            <Badge variant="secondary" className="w-fit">
              Disabled (Single Connection)
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <Zap className="h-4 w-4" />
            <span>Prepared Statements</span>
          </div>
          {summary.preparedStatements ? (
            <Badge variant="default" className="w-fit">
              Enabled
            </Badge>
          ) : (
            <Badge variant="secondary" className="w-fit">
              Disabled
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span>SSL/TLS</span>
          </div>
          {summary.requiresSSL ? (
            <Badge variant="default" className="w-fit">
              Required
            </Badge>
          ) : (
            <Badge variant="secondary" className="w-fit">
              Not Required
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
