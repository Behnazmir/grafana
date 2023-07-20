import { from, lastValueFrom, merge, Observable, of } from 'rxjs';

import {
  DataFrame,
  dataFrameToJSON,
  DataQuery,
  DataQueryRequest,
  DataQueryResponse,
  TestDataSourceResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  DataSourceJsonData,
  DataSourceRef,
  makeClassES5Compatible,
  parseLiveChannelAddress,
  ScopedVars,
} from '@grafana/data';

import { PublicDashboardDataSource } from '../../../../public/app/features/dashboard/services/PublicDashboardDataSource';
import {
  BackendSrvRequest,
  FetchResponse,
  getBackendSrv,
  getGrafanaLiveSrv,
  StreamingFrameAction,
  StreamingFrameOptions,
} from '../services';

import { AuthorizedDataSource } from './AuthorizedDataSource';

/**
 * @internal
 */
export const ExpressionDatasourceRef = Object.freeze({
  type: '__expr__',
  uid: '__expr__',
  name: 'Expression',
});

/**
 * @internal
 */
export function isExpressionReference(ref?: DataSourceRef | string | null): boolean {
  if (!ref) {
    return false;
  }
  const v = typeof ref === 'string' ? ref : ref.type;
  return v === ExpressionDatasourceRef.type || v === ExpressionDatasourceRef.name || v === '-100'; // -100 was a legacy accident that should be removed
}

export class HealthCheckError extends Error {
  details: HealthCheckResultDetails;

  constructor(message: string, details: HealthCheckResultDetails) {
    super(message);
    this.details = details;
    this.name = 'HealthCheckError';
  }
}

/**
 * Describes the current health status of a data source plugin.
 *
 * @public
 */
export enum HealthStatus {
  Unknown = 'UNKNOWN',
  OK = 'OK',
  Error = 'ERROR',
}

// Internal for now
enum PluginRequestHeaders {
  PluginID = 'X-Plugin-Id', // can be used for routing
  DatasourceUID = 'X-Datasource-Uid', // can be used for routing/ load balancing
  DashboardUID = 'X-Dashboard-Uid', // mainly useful for debugging slow queries
  PanelID = 'X-Panel-Id', // mainly useful for debugging slow queries
  QueryGroupID = 'X-Query-Group-Id', // mainly useful to find related queries with query splitting
  FromExpression = 'X-Grafana-From-Expr', // used by datasources to identify expression queries
}

/**
 * Describes the details in the payload returned when checking the health of a data source
 * plugin.
 *
 * If the 'message' key exists, this will be displayed in the error message in DataSourceSettingsPage
 * If the 'verboseMessage' key exists, this will be displayed in the expandable details in the error message in DataSourceSettingsPage
 *
 * @public
 */
export type HealthCheckResultDetails = Record<string, unknown> | undefined;

/**
 * Describes the payload returned when checking the health of a data source
 * plugin.
 *
 * @public
 */
export interface HealthCheckResult {
  status: HealthStatus;
  message: string;
  details: HealthCheckResultDetails;
}

/**
 * Extend this class to implement a data source plugin that is depending on the Grafana
 * backend API.
 *
 * @public
 */
class DataSourceWithBackend<
  TQuery extends DataQuery = DataQuery,
  TOptions extends DataSourceJsonData = DataSourceJsonData,
> extends DataSourceApi<TQuery, TOptions> {
  private dataSourceApi: DataSourceApi<DataQuery, DataSourceJsonData>;
  constructor(instanceSettings: DataSourceInstanceSettings<TOptions>) {
    super(instanceSettings);
    this.dataSourceApi = instanceSettings.isPublicDashboard
      ? new PublicDashboardDataSource(this)
      : new AuthorizedDataSource(instanceSettings);
  }

  /**
   * Ideally final -- any other implementation may not work as expected
   */
  query(request: DataQueryRequest<TQuery>): Observable<DataQueryResponse> {
    return from(this.dataSourceApi.query(request));
  }

  /** Get request headers with plugin ID+UID set */
  protected getRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    headers[PluginRequestHeaders.PluginID] = this.type;
    headers[PluginRequestHeaders.DatasourceUID] = this.uid;
    return headers;
  }

  /**
   * Apply template variables for explore
   */
  interpolateVariablesInQueries(queries: TQuery[], scopedVars: ScopedVars | {}): TQuery[] {
    return queries.map((q) => this.applyTemplateVariables(q, scopedVars) as TQuery);
  }

  /**
   * Override to apply template variables.  The result is usually also `TQuery`, but sometimes this can
   * be used to modify the query structure before sending to the backend.
   *
   * NOTE: if you do modify the structure or use template variables, alerting queries may not work
   * as expected
   *
   * @virtual
   */
  applyTemplateVariables(query: TQuery, scopedVars: ScopedVars): Record<string, any> {
    return query;
  }

  /**
   * Optionally override the streaming behavior
   */
  streamOptionsProvider: StreamOptionsProvider<TQuery> = standardStreamOptionsProvider;

  /**
   * Make a GET request to the datasource resource path
   */
  async getResource<T = any>(
    path: string,
    params?: BackendSrvRequest['params'],
    options?: Partial<BackendSrvRequest>
  ): Promise<T> {
    const headers = this.getRequestHeaders();
    const result = await lastValueFrom(
      getBackendSrv().fetch<T>({
        ...options,
        method: 'GET',
        headers: options?.headers ? { ...options.headers, ...headers } : headers,
        params: params ?? options?.params,
        url: `/api/datasources/uid/${this.uid}/resources/${path}`,
      })
    );
    return result.data;
  }

  /**
   * Send a POST request to the datasource resource path
   */
  async postResource<T = any>(
    path: string,
    data?: BackendSrvRequest['data'],
    options?: Partial<BackendSrvRequest>
  ): Promise<T> {
    const headers = this.getRequestHeaders();
    const result = await lastValueFrom(
      getBackendSrv().fetch<T>({
        ...options,
        method: 'POST',
        headers: options?.headers ? { ...options.headers, ...headers } : headers,
        data: data ?? { ...data },
        url: `/api/datasources/uid/${this.uid}/resources/${path}`,
      })
    );
    return result.data;
  }

  /**
   * Run the datasource healthcheck
   */
  async callHealthCheck(): Promise<HealthCheckResult> {
    return lastValueFrom(
      getBackendSrv().fetch<HealthCheckResult>({
        method: 'GET',
        url: `/api/datasources/uid/${this.uid}/health`,
        showErrorAlert: false,
        headers: this.getRequestHeaders(),
      })
    )
      .then((v: FetchResponse) => v.data)
      .catch((err) => err.data);
  }

  /**
   * Checks the plugin health
   * see public/app/features/datasources/state/actions.ts for what needs to be returned here
   */
  async testDatasource(): Promise<TestDataSourceResponse> {
    return this.callHealthCheck().then((res) => {
      if (res.status === HealthStatus.OK) {
        return {
          status: 'success',
          message: res.message,
        };
      }

      return Promise.reject({
        status: 'error',
        message: res.message,
        error: new HealthCheckError(res.message, res.details),
      });
    });
  }
}

/**
 * @internal exported for tests
 */
export function toStreamingDataResponse<TQuery extends DataQuery = DataQuery>(
  rsp: DataQueryResponse,
  req: DataQueryRequest<TQuery>,
  getter: (req: DataQueryRequest<TQuery>, frame: DataFrame) => Partial<StreamingFrameOptions>
): Observable<DataQueryResponse> {
  const live = getGrafanaLiveSrv();
  if (!live) {
    return of(rsp); // add warning?
  }

  const staticdata: DataFrame[] = [];
  const streams: Array<Observable<DataQueryResponse>> = [];
  for (const f of rsp.data) {
    const addr = parseLiveChannelAddress(f.meta?.channel);
    if (addr) {
      const frame: DataFrame = f;
      streams.push(
        live.getDataStream({
          addr,
          buffer: getter(req, frame),
          frame: dataFrameToJSON(f),
        })
      );
    } else {
      staticdata.push(f);
    }
  }
  if (staticdata.length) {
    streams.push(of({ ...rsp, data: staticdata }));
  }
  if (streams.length === 1) {
    return streams[0]; // avoid merge wrapper
  }
  return merge(...streams);
}

/**
 * This allows data sources to customize the streaming connection query
 *
 * @public
 */
export type StreamOptionsProvider<TQuery extends DataQuery = DataQuery> = (
  request: DataQueryRequest<TQuery>,
  frame: DataFrame
) => Partial<StreamingFrameOptions>;

/**
 * @public
 */
export const standardStreamOptionsProvider: StreamOptionsProvider = (request: DataQueryRequest, frame: DataFrame) => {
  const opts: Partial<StreamingFrameOptions> = {
    maxLength: request.maxDataPoints ?? 500,
    action: StreamingFrameAction.Append,
  };

  // For recent queries, clamp to the current time range
  if (request.rangeRaw?.to === 'now') {
    opts.maxDelta = request.range.to.valueOf() - request.range.from.valueOf();
  }
  return opts;
};

//@ts-ignore
DataSourceWithBackend = makeClassES5Compatible(DataSourceWithBackend);

export { DataSourceWithBackend };
