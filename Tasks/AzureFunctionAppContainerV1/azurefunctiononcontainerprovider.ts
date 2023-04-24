import { TaskParameters } from './taskparameters';
import { KuduServiceUtility } from './operations/KuduServiceUtility';
import { AzureAppService } from './azure-arm-rest/azure-arm-app-service';
import { AzureRMEndpoint } from 'azure-pipelines-tasks-azurermdeploycommon/azure-arm-rest/azure-arm-endpoint';
import { Kudu } from './azure-arm-rest/azure-arm-app-service-kudu';
import { AzureEndpoint } from 'azure-pipelines-tasks-azurermdeploycommon/azure-arm-rest/azureModels';
import { AzureAppServiceUtility } from './operations/AzureAppServiceUtility';
import { AzureResourceFilterUtility } from 'azure-pipelines-tasks-azurermdeploycommon/operations/AzureResourceFilterUtility';
import tl = require('azure-pipelines-task-lib/task');
import { addReleaseAnnotation } from './operations/ReleaseAnnotationUtility';
import { ContainerBasedDeploymentUtility } from './operations/ContainerBasedDeploymentUtility';
const linuxFunctionStorageSettingName: string = '-WEBSITES_ENABLE_APP_SERVICE_STORAGE';
const linuxFunctionStorageSettingValue: string = 'false';
import * as ParameterParser from 'azure-pipelines-tasks-azurermdeploycommon/operations/ParameterParserUtility';

export class AzureFunctionOnContainerDeploymentProvider{
    protected taskParams:TaskParameters;
    protected appService: AzureAppService;
    protected kuduService: Kudu;
    protected appServiceUtility: AzureAppServiceUtility;
    protected kuduServiceUtility: KuduServiceUtility;
    protected azureEndpoint: AzureEndpoint;
    protected activeDeploymentID; 
    protected isCentauri : boolean;

    constructor(taskParams: TaskParameters) {
        this.taskParams = taskParams;
    }

    public async PreDeploymentStep() {
        this.azureEndpoint = await new AzureRMEndpoint(this.taskParams.connectedServiceName).getEndpoint();
        console.log(tl.loc('GotconnectiondetailsforazureRMWebApp0', this.taskParams.WebAppName));
        
        if(!this.taskParams.ResourceGroupName) {
            let appDetails = await AzureResourceFilterUtility.getAppDetails(this.azureEndpoint, this.taskParams.WebAppName);
            this.taskParams.ResourceGroupName = appDetails["resourceGroupName"];
        }

        this.appService = new AzureAppService(this.azureEndpoint, this.taskParams.ResourceGroupName, this.taskParams.WebAppName, this.taskParams.SlotName);
        this.appServiceUtility = new AzureAppServiceUtility(this.appService);
        this.taskParams.isLinuxContainerApp = true;
        this.isCentauri = await this.appServiceUtility.isFunctionAppOnCentauri();
        if (!this.isCentauri){
            this.kuduService = await this.appServiceUtility.getKuduService();
            this.kuduServiceUtility = new KuduServiceUtility(this.kuduService);
        }
        tl.debug(`Resource Group: ${this.taskParams.ResourceGroupName}`);
        tl.debug(`is Linux container web app: ${this.taskParams.isLinuxContainerApp}`);
    }

    public async DeployWebAppStep() {
        tl.debug("Performing container based deployment.");
        let containerDeploymentUtility: ContainerBasedDeploymentUtility = new ContainerBasedDeploymentUtility(this.appService);
        if (this.isCentauri){
            await containerDeploymentUtility.deployWebAppImage(this.taskParams, false);
            let linuxFunctionStorageSetting: string = ''; 
            if (!this.taskParams.AppSettings || this.taskParams.AppSettings.indexOf(linuxFunctionStorageSettingName) < 0) { 
                linuxFunctionStorageSetting = `${linuxFunctionStorageSettingName} ${linuxFunctionStorageSettingValue}`; 
            }
            this.taskParams.AppSettings = this.taskParams.AppSettings ? this.taskParams.AppSettings.trim() + " " + linuxFunctionStorageSetting : linuxFunctionStorageSetting;
            let customApplicationSettings = ParameterParser.parse(this.taskParams.AppSettings);
            await this.appServiceUtility.updateAndMonitorAppSettings(customApplicationSettings, null, null, false);
        } else {
            await containerDeploymentUtility.deployWebAppImage(this.taskParams);
            let linuxFunctionStorageSetting: string = ''; 
            if (!this.taskParams.AppSettings || this.taskParams.AppSettings.indexOf(linuxFunctionStorageSettingName) < 0) { 
                linuxFunctionStorageSetting = `${linuxFunctionStorageSettingName} ${linuxFunctionStorageSettingValue}`; 
            }
            this.taskParams.AppSettings = this.taskParams.AppSettings ? this.taskParams.AppSettings.trim() + " " + linuxFunctionStorageSetting : linuxFunctionStorageSetting;
            let customApplicationSettings = ParameterParser.parse(this.taskParams.AppSettings);
            await this.appServiceUtility.updateAndMonitorAppSettings(customApplicationSettings);
            
            await this.appServiceUtility.updateScmTypeAndConfigurationDetails();
        }
    }

    public async UpdateDeploymentStatus(isDeploymentSuccess: boolean) {
        if (!this.isCentauri){
            if(this.kuduServiceUtility) {
                await addReleaseAnnotation(this.azureEndpoint, this.appService, isDeploymentSuccess);
                this.activeDeploymentID = await this.kuduServiceUtility.updateDeploymentStatus(isDeploymentSuccess, null, {'type': 'Deployment', slotName: this.appService.getSlot()});
                tl.debug('Active DeploymentId :'+ this.activeDeploymentID);
            }

            let appServiceApplicationUrl: string = await this.appServiceUtility.getApplicationURL();
            console.log(tl.loc('AppServiceApplicationURL', appServiceApplicationUrl));
            tl.setVariable('AppServiceApplicationUrl', appServiceApplicationUrl);
        }
        else{
            tl.debug('Active DeploymentId :'+ this.activeDeploymentID);
        }
    }
}