/**
 * Created by jakeconway on 2/13/17.
 */


var foundationToFhir = angular.module("foundationToFhir", []);

foundationToFhir.controller("foundationToFhirCtrl", function ($scope) {
    $scope.files = null;
});

foundationToFhir.config(function($interpolateProvider) {
    $interpolateProvider.startSymbol('[{');
    $interpolateProvider.endSymbol('}]');
});

foundationToFhir.config(function ($httpProvider) {
    $httpProvider.defaults.xsrfCookieName = 'csrftoken';
    $httpProvider.defaults.xsrfHeaderName = 'X-CSRFToken';
});

foundationToFhir.directive("grabFiles", function () {
    return {
        restrict: "A",
        scope: {},
        link: link
    };

    function link(scope, element) {
        var el = element[0];

        d3.select(el).append("p")
            .html("File Input: ");

        d3.select(el).append("input")
            .attr("id", "foundationFiles")
            .attr("name", "foundationFiles[]")
            .attr("type", "file")
            .attr("multiple", "multiple")
            .on("change", function () {
                var fileArr = readFiles(this.files);
                setTimeout(function () {
                    scope.$apply(function () {
                        scope.$parent.files = fileArr;
                    });
                }, 50);
            });
    }
});

foundationToFhir.directive("baseUrl", function() {
   return {
       restrict: "A",
       scope: {},
       link: link
   };

   function link(scope, element) {
       var el = element[0];

       d3.select(el).append("p")
           .html("Base URL: ");

       d3.select(el).append("input")
           .attr("id", "base-url")
           .attr("type", "text")
           .attr("name", "baseurl")
           .style("width", "300px");

       $("#base-url").val("https://fhirtest.uhn.ca/baseDstu3/");
   }
});

foundationToFhir.directive("foundationToFhirDirective", ['$http', function ($http) {
    return {
        restrict: "A",
        scope: {
            files: "="
        },
        link: link
    };

    function link(scope, element) {
        var files = scope.files;
        scope.uploadedPatientInfo = {};
        var el = element[0];

        scope.$watch("files", function (updated) {
            if (files == updated) {
                return;
            }
            files = updated;

            generateResourcesFromFoundation(scope, files, $http);
        });
    }
}]);

function initResources(scope, $http, files, i, l) {
    if (i == l) {
        d3.select("#parser-div").append("h2")
            .html("----- COMPLETE -----");
        window.scrollTo(0,document.body.scrollHeight);
        var patientInfo = scope.uploadedPatientInfo;
        setTimeout(function() {
            $http({
                url: "/transfer/",
                method: "POST",
                data: patientInfo
            }).then(function(success){
                setTimeout(function() {
                    window.location = "/checkpatients/";
                }, 200);
            }, function(error) {
                console.log(error);
            });
            //window.location = "/checkpatients";
            // comment out above window.location and post, and uncomment the one below when doing development testing on this JS library
           // window.location = "http://localhost:63342/FoundationToFHIRjs/checkpatients.html" + "?patientInfo=" + patientInfo;
        }, 50);
        return;
    }
    var parser = generateDOMParser();
    var DOM = parser.parseFromString(files[i], "text/xml");

    //Foundation Medicine organization resource
    var FoundationMedicine = new foundationFhirOrganization();
    //ABC Oncology in example.. has ID
    var organization = new foundationFhirOrganization();
    //Has ID from XML files
    var orderingPhysician = new foundationFhirPractitioner();
    /*** no direct ID for pathologist ***/
    var pathologist = new foundationFhirPractitioner();
    //Patient has ID from XML
    var patient = new foundationFhirPatient();
    //Has ID
    var diagnosticReport = new foundationFhirDiagnosticReport();
    //Obtain conclusions from report.. this tells us how many observations there will be
    diagnosticReportAddConclusionFromFoundation(diagnosticReport, DOM);
    //All have IDs
    var observationArr = [];
    //add patient as subject of observation
    initObservations(observationArr, diagnosticReport.getObservationsInReportCount());
    //Has ID
    var condition = new foundationFhirCondition();
    //Has ID
    var procedureRequest = new foundationFhirProcedureRequest();
    //Has ID
    var specimen = foundationFhirSpecimen();
    //Has ID
    var provenance = foundationFhirProvenance();

    //Add all of the IDs to the resources, then PUT to the server
    //This way we can reference them to each other without getting back an error when PUTing..
    //wont have to worry about if one is not created when we reference it during PUT
    organizationAddIdFromFoundation(organization.organizationResource, "MedFacilID", DOM);
    FoundationMedicine.organizationResource.id = "FM";
    practitionerAddIdFromFoundation(orderingPhysician.practitionerResource, "OrderingMDId", DOM);
    patientAddIdFromFoundation(patient.patientResource, DOM);
    pathologist.practitionerResource.id = patient.patientResource.id + "patho1";
    conditionAddId(condition.conditionResource, patient.getPatientId());
    diagnosticReportAddId(diagnosticReport.diagnosticReportResource, DOM);
    procedureRequestAddId(procedureRequest.procedureRequestResource, diagnosticReport.getDiagnosticReportId());
    specimenAddId(specimen.specimenResource, DOM);
    //Add type to specimen now since it is used to reference specimen in genomic alterations
    specimenAddTypeFromFoundation(specimen.specimenResource, DOM);
    //Add patient id to observation objects since it is used to make the ID of all clinical resources
    addReportIdToObservationObj(observationArr, diagnosticReport.getDiagnosticReportId());
    //Add id to observations when adding genomic information..
    //this is so we can link genomic alterations to therapies and clinical trials
    observationAddGenomicInfoFromFoundation(observationArr, specimen.getSpecimenId(), specimen.getSpecimenType(), DOM);
    provenanceAddId(provenance.provenanceResource, diagnosticReport.getDiagnosticReportId());

    //init rearrangement resources because we have to link to to each other.. if we wait, one will exist on the server while the other doesnt
    // e.g. if target-gene exists and is linked to other-gene, but other-gene isnt on server when target-gene is PUT, then it will throw error
    var rearrangements = DOM.getElementsByTagName("rearrangement");
    var rearrangementsArr = makeInitRearrangementsArr(rearrangements, diagnosticReport.getDiagnosticReportId());
    putNonInitializedResourcesToHapiFhirDstu3Server($http, rearrangementsArr, 0, null);

    var resourceArr = [FoundationMedicine, organization, orderingPhysician, pathologist, patient, condition, specimen,
        diagnosticReport, procedureRequest, provenance].concat(observationArr);

    scope.uploadedPatientInfo[patient.getPatientId()] = [
        "Organization/" + FoundationMedicine.getOrganizationId(),
        "Organization/" + organization.getOrganizationId(),
        "Practitioner/" + orderingPhysician.getPractitionerId(),
        "Practitioner/" + pathologist.getPractitionerId(),
        "Patient/" + patient.getPatientId(),
        "DiagnosticReport/" + diagnosticReport.getDiagnosticReportId(),
        "Condition/" + condition.getConditionId(),
        "procedureRequest/" + procedureRequest.getProcedureRequestId(),
        "Specimen/" + specimen.getSpecimenId(),
        "Provenance/" + provenance.getProvenanceId()
    ];

    putResourcesToHapiFhirDstu3Server(scope, $http, resourceArr, 0, resourceArr.length, "Initializing", i, files, l, DOM);
}

function makeInitRearrangementsArr(rearrangements, reportId) {
    var arr = [];
    var l = rearrangements.length;
    for(var i = 0; i < l; i++) {
        var observation1 = foundationFhirObservation();
        var observation2 = foundationFhirObservation();
        observation1.observationResource.id =  reportId + "-rearrangement-targeted-gene-" + (i+1);
        observation2.observationResource.id =  reportId + "-rearrangement-other-gene-" + (i+1);
        arr.push(observation1, observation2);
    }
    return arr;
}

function foundationPractitionerAssertersToArr(practitioners, practitionerIdsAndNames) {
    var practitionerArr = [];
    var l = practitionerIdsAndNames.length;
    for(var i = 0; i < l; i++) {
        practitionerArr.push({
            practitionerResource: practitioners[practitionerIdsAndNames[i].name],
            resourceType: "Practitioner"
        });
    }
    return practitionerArr;
}

function addResourceRelativeUrlsToUploadedPatientInfo(resourceArr, uploadedPatientInfo) {
    var l = resourceArr.length;
    for (var i = 0; i < l; i++) {
        var data = resourceArr[i][resourceArr[i].resourceType.lowerCaseFirstLetter() + "Resource"];
        uploadedPatientInfo.push(resourceArr[i].resourceType + "/" + data.id);
    }
}

function completeResources(scope, $http, FoundationMedicine, organization, orderingPhysician, pathologist, patient, condition, specimen,
                           diagnosticReport, procedureRequest, provenance, observationArr, fileIndex, files, nFiles, nResources, DOM) {
    organizationAddIdentifierFromFoundation(organization.organizationResource, DOM);
    organizationAddNameFromFoundation(organization.organizationResource, DOM);

    createFoundationMedicineOrganization(FoundationMedicine.organizationResource);


    practitionerAddNameFromFoundation(orderingPhysician.practitionerResource, "OrderingMD", DOM);
    practitionerAddRoleFromFoundation(orderingPhysician.practitionerResource, "OrderingMD", organization);

    practitionerAddNameFromFoundation(pathologist.practitionerResource, "Pathologist", DOM);
    practitionerAddRoleFromFoundation(pathologist.practitionerResource, "Pathologist", null);

    patientAddNameFromFoundation(patient.patientResource, DOM);
    patientAddGenderFromFoundation(patient.patientResource, DOM);
    patientAddBirthDateFromFoundation(patient.patientResource, DOM);
    patientAddIdentifierFromFoundation(patient.patientResource, DOM);
    //postToHapiFhirDstu3Server($http, 'Patient', patient.patientResource);

    diagnosticReportAddCategoryFromFoundation(diagnosticReport.diagnosticReportResource, DOM);
    addPatientSubjectReference(diagnosticReport.diagnosticReportResource, patient.getPatientId(), patient.getPatientFullName());
    diagnosticReportAddEffectiveDateTimeFromFoundation(diagnosticReport.diagnosticReportResource, DOM);
    addFoundationAsPerformer(diagnosticReport.diagnosticReportResource);

    addPatientSubjectReferenceToObservations(observationArr, patient.getPatientId(), patient.getPatientFullName());
    observationAddEffectiveDateTimeFromFoundation(observationArr, diagnosticReport.getReportDate());
    relateObservations(observationArr);

    conditionAddCodeFromFoundation(condition.conditionResource, DOM);
    conditionAddBodySiteFromFoundation(condition.conditionResource, DOM);
    addPatientSubjectReference(condition.conditionResource, patient.getPatientId(), patient.getPatientFullName());
    conditionAddEvidenceDetailReference(condition.conditionResource, diagnosticReport.getDiagnosticReportId(), DOM);

    procedureRequestAddNote(procedureRequest.procedureRequestResource, diagnosticReport.getDiagnosticReportTestPerformed());
    procedureRequestAddreasonReference(procedureRequest.procedureRequestResource, condition.getConditionId(), condition.getCondition());
    procedureRequestAddRequester(procedureRequest.procedureRequestResource, orderingPhysician, organization);
    addPatientSubjectReference(procedureRequest.procedureRequestResource, patient.getPatientId(), patient.getPatientFullName());
    addFoundationAsPerformer(procedureRequest.procedureRequestResource);
    addSpecimenReference(procedureRequest.procedureRequestResource, specimen.getSpecimenId(), specimen.getSpecimenType());

    addPatientSubjectReference(specimen.specimenResource, patient.getPatientId(), patient.getPatientFullName());
    specimenAddRequestReference(specimen.specimenResource, procedureRequest.getProcedureRequestId(), procedureRequest.getProcedureRequestNote());
    specimenAddNoteFromFoundation(specimen.specimenResource, DOM);
    specimenAddReceivedTimeFromFoundation(specimen.specimenResource, DOM);
    specimenAddCollectionInfoFromFoundation(specimen.specimenResource, DOM);
    specimenAddPathologistAsCollector(specimen.specimenResource, pathologist.getPractitionerId(), pathologist.getPractitionerName());

    var sequenceArr = [];
    var variantReportObservations = [];
    addVariantReportShortVariantSequencesAndObservations(variantReportObservations, sequenceArr, diagnosticReport, specimen, patient, DOM);
    addVariantReportCopyNumberAlterationSequencesAndObservations(variantReportObservations, sequenceArr, diagnosticReport, specimen, patient, DOM);
    addVariantReportRearrangementSequencesAndObservations(variantReportObservations, sequenceArr, diagnosticReport, specimen, patient, DOM);

    //add variant-report observations to observation array so we can link to DiagnosticReport
    observationArr = observationArr.concat(variantReportObservations);

    provenanceAddRecordedTimeFromFoundation(provenance.provenanceResource, DOM);
    provenanceAddTargetResources(provenance.provenanceResource, diagnosticReport.getDiagnosticReportId(),
        diagnosticReport.getNameOfDiagnosticReport(), observationArr);
    provenanceAddSignaturesFromFoundation(provenance.provenanceResource, foundationPractitionerAsserters(), provenance.getRecordedTime(), DOM);
    var practitionerIdsAndNames = getPractitionerNamesAndIdsFromSignatures(provenance.getSignaturesArray());
    provenanceAddAgentFromFoundation(provenance.provenanceResource, practitionerIdsAndNames);

    var foundationPractitionerArr = foundationPractitionerAssertersToArr(foundationPractitionerAsserters().practitioners, practitionerIdsAndNames);

    addResourceRelativeUrlsToUploadedPatientInfo(observationArr.concat(foundationPractitionerArr, sequenceArr),
        scope.uploadedPatientInfo[patient.getPatientId()]);

    //go back and link all of the observations to the diagnostic report
    diagnosticReportReferenceObservations(diagnosticReport.diagnosticReportResource, observationArr);

    addSpecimenReference(diagnosticReport.diagnosticReportResource, specimen.getSpecimenId(), specimen.getSpecimenType());

    diagnosticReportAddContainedArr(diagnosticReport.diagnosticReportResource, observationArr, specimen);

    var resourceArr = [FoundationMedicine, organization, orderingPhysician, pathologist, patient, condition, specimen,
        diagnosticReport, procedureRequest, provenance].concat(observationArr);

    var completionConfig = {
        scope: scope,
        resourceArr: resourceArr,
        index: 0,
        nResources: nResources,
        method: "Completing",
        fileIndex: fileIndex,
        files: files,
        nFiles: nFiles,
        DOM: DOM
    };

    putNonInitializedResourcesToHapiFhirDstu3Server($http, sequenceArr.concat(variantReportObservations, foundationPractitionerArr), 0, completionConfig);
}

function generateResourcesFromFoundation(scope, files, $http) {
    var l = files.length;
    var fileIndex = 0;
    initResources(scope, $http, files, fileIndex, l);
}

function getPractitionerNamesAndIdsFromSignatures(signatures) {
    var practitioners = [];
    var l = signatures.length;
    for (var i = 0; i < l; i++) {
        practitioners.push({
            id: signatures[i].whoReference.reference,
            name: signatures[i].whoReference.display
        });
    }
    return practitioners;
}

function putResourcesToHapiFhirDstu3Server(scope, $http, resourceArr, index, nResources, method, fileIndex, files, nFiles, DOM) {
    if(index == nResources) {
        if(method == "Initializing") {
            var nonObservations = resourceArr.splice(0, 10);
            completeResources(scope, $http, nonObservations[0], nonObservations[1], nonObservations[2], nonObservations[3], nonObservations[4], nonObservations[5],
            nonObservations[6], nonObservations[7], nonObservations[8], nonObservations[9], resourceArr, fileIndex, files, nFiles, nResources, DOM);
            return;
        }
        if(method == "Completing") {
            initResources(scope, $http, files, fileIndex+1, nFiles);
            return;
        }
    }
    var type = resourceArr[index].resourceType;
    putToHapiFhirDstu3Server(scope, $http, type, resourceArr, index, nResources, method, fileIndex, files, nFiles, DOM);
    return;
}

function putNonInitializedResourcesToHapiFhirDstu3Server($http, resourceArr, index, completionConfig) {
    if(resourceArr.length == index) {
        if(completionConfig != null) {
            putResourcesToHapiFhirDstu3Server(completionConfig.scope, $http, completionConfig.resourceArr, completionConfig.index,
                completionConfig.nResources, completionConfig.method, completionConfig.fileIndex, completionConfig.files, completionConfig.nFiles,
                completionConfig.DOM);
        }
        return;
    }
    var type = resourceArr[index].resourceType;
    putNonInitializedResourceToHapiFhirDstu3Server($http, resourceArr, type, index, completionConfig);
}

function putNonInitializedResourceToHapiFhirDstu3Server($http, resourceArr, type, index, completionConfig) {
    var data = resourceArr[index][type.lowerCaseFirstLetter() + "Resource"];
    var id = data.id;
    var baseUrl = $("#base-url").val();
    var url = baseUrl + type+ "/" + id+ "?_format=json";
    $http.put(url, data).then(function(success) {
        d3.select("#parser-div").append("p")
                .html("<b>" + "Initializing" + ":</b> " + data.resourceType + " resource <b>" + id+ "</b> <span style='color:#2f0'>successfully</span> PUT to " + baseUrl);
        window.scrollTo(0,document.body.scrollHeight);
        putNonInitializedResourcesToHapiFhirDstu3Server($http, resourceArr, index+1, completionConfig);
    }, function(error) {
        console.log(error);
    });
}


function putToHapiFhirDstu3Server(scope, $http, type, resourceArr, index, nResources, method, fileIndex, files, nFiles, DOM) {
    var data = resourceArr[index][type.lowerCaseFirstLetter() + "Resource"];
    var id = data.id;
    var baseUrl = $("#base-url").val();
    var url = baseUrl + type + "/" + id + '?_format=json';

    $http.put(url, data).then(function (success) {
        d3.select("#parser-div").append("p")
                .html("<b>" + method + ":</b> " + data.resourceType + " resource <b>" + id + "</b> <span style='color:#2f0'>successfully</span> PUT to " + baseUrl);
        window.scrollTo(0,document.body.scrollHeight);
        putResourcesToHapiFhirDstu3Server(scope, $http, resourceArr, index+1, nResources, method, fileIndex, files, nFiles, DOM);
    }, function (error) {
        console.log(error);
        d3.select("#parser-div").append("p")
                .html("<b>" + method + ":</b> " + data.resourceType + " resource <b>" + id + "</b> <span style='color:red'>ERRORED</span> during PUT. Please see console for details");
        window.scrollTo(0,document.body.scrollHeight);
        putResourcesToHapiFhirDstu3Server(scope, $http, resourceArr, index+1, nResources, method, fileIndex, files, nFiles, DOM);
    });
}

function relateObservations(observationArr) {
    var l = observationArr.length;
    for(var i = 0; i< l; i++) {
        observationArr[i].observationResource.related = observationArr[i].related;
    }
}

function createFoundationMedicineOrganization(FMorganization) {
    FMorganization.id = "FM";
    FMorganization.identifier = [{
        use: "official",
        type: {
            text: "CLIA identification number"
        },
        system: "https://wwwn.cdc.gov/clia/Resources/LabSearch.aspx",
        value: "22D2027531"
    }];
    FMorganization.active = true;
    FMorganization.type = {
        coding: [{
            system: "http://hl7.org/fhir/ValueSet/organization-type",
            code: "prov",
            display: "Genomic healthcare provider"
        }],
        text: "Genomic healthcare provider"
    };
    FMorganization.name = "Foundation Medicine";
    FMorganization.telecom = [
        {
            system: "phone",
            value: "(+1) 617-418-2200"
        },
        {
            system: "fax",
            value: "(+1) 617-418-2290"
        },
        {
            system: "email",
            value: "client.services@foundationmedicine.com"
        }
    ];
    FMorganization.address = [
        {
            line: [
                "150 Second Street"
            ],
            city: "Cambridge",
            state: "MA",
            postalCode: "02141",
            country: "USA"
        }
    ];

}

function foundationFhirSequence() {
    return {
        sequenceResource: {
            resourceType: "Sequence"
            //add subject reference
        },
        resourceType: "Sequence",
        getSequenceId: function() {
            return this.sequenceResource.id;
        }
    }
}

function addVariantReportRearrangementSequencesAndObservations(observationArr, sequenceArr, diagnosticReport, specimen, patient, DOM) {
    var rearrangements = DOM.getElementsByTagName("rearrangement");
    var date = diagnosticReport.getReportDate();
    var reportId = diagnosticReport.getDiagnosticReportId();
    // Might need to account for more than 1 sample
    var nucleicAcidType = DOM.getElementsByTagName("sample")[0].getAttribute("nucleic-acid-type");
    var l = rearrangements.length;
    for(var i = 0; i < l; i++) {
        observationAndSequenceAddRearrangementInfo(observationArr, sequenceArr, rearrangements[i], nucleicAcidType, date, specimen, patient, reportId, i+1);
    }
}

function observationAndSequenceAddRearrangementInfo(observationArr, sequenceArr, rearrangement, nucleicAcidType, date, specimen, patient, reportId, variantNumber) {
    var sequence1 = foundationFhirSequence();
    sequenceAddRearrangementId(sequence1.sequenceResource, reportId, variantNumber, "target-gene");
    sequenceRearrangementAddStructureVariantFromFoundation(sequence1.sequenceResource, rearrangement, "pos1");
    sequenceAddReferenceToSpecimen(sequence1.sequenceResource, specimen.getSpecimenId(), specimen.getSpecimenType());
    sequenceAddTypeFromFoundation(sequence1.sequenceResource, nucleicAcidType);
    sequenceRearrangementAddRefSeqChromosome(sequence1.sequenceResource, rearrangement, "pos1");
    addPatientSubjectReference(sequence1.sequenceResource, patient.getPatientId(), patient.getPatientFullName());
    addFoundationAsPerformer(sequence1.sequenceResource);
    sequenceArr.push(sequence1);

    var observation1 = foundationFhirObservation();
    addRearrangementId(observation1.observationResource, reportId, variantNumber, "targeted-gene");
    addRearrangementGeneNameFromFoundation(observation1.observationResource, rearrangement, "targeted-gene");
    variantReportAddReferenceToSequence(observation1.observationResource, sequence1.getSequenceId());
    variantReportAddSequenceVariantType(observation1.observationResource, rearrangement);
    singleObservationAddDateTimeFromFoundation(observation1.observationResource, date);
    observationAddReferenceToSpecimen(observation1.observationResource, specimen.getSpecimenId(), specimen.getSpecimenType());
    addPatientSubjectReference(observation1.observationResource, patient.getPatientId(), patient.getPatientFullName());
    addFoundationAsPerformer(observation1.observationResource);

    var sequence2 = foundationFhirSequence();
    sequenceAddRearrangementId(sequence2.sequenceResource, reportId, variantNumber, "other-gene");
    sequenceRearrangementAddStructureVariantFromFoundation(sequence2.sequenceResource, rearrangement, "pos2");
    sequenceAddReferenceToSpecimen(sequence2.sequenceResource, specimen.getSpecimenId(), specimen.getSpecimenType());
    sequenceAddTypeFromFoundation(sequence2.sequenceResource, nucleicAcidType);
    sequenceRearrangementAddRefSeqChromosome(sequence2.sequenceResource, rearrangement, "pos2");
    addPatientSubjectReference(sequence2.sequenceResource, patient.getPatientId(), patient.getPatientFullName());
    addFoundationAsPerformer(sequence2.sequenceResource);
    sequenceArr.push(sequence2);

    var observation2 = foundationFhirObservation();
    addRearrangementId(observation2.observationResource, reportId, variantNumber, "other-gene");
    addRearrangementGeneNameFromFoundation(observation2.observationResource, rearrangement, "other-gene");
    variantReportAddReferenceToSequence(observation2.observationResource, sequence2.getSequenceId());
    variantReportAddSequenceVariantType(observation2.observationResource, rearrangement);
    singleObservationAddDateTimeFromFoundation(observation2.observationResource, date);
    observationAddReferenceToSpecimen(observation2.observationResource, specimen.getSpecimenId(), specimen.getSpecimenType());
    addPatientSubjectReference(observation2.observationResource, patient.getPatientId(), patient.getPatientFullName());
    addFoundationAsPerformer(observation2.observationResource);

    relateRearrangementObservations(observation1, observation2);
    observationArr.push(observation1);
    observationArr.push(observation2);
}

function relateRearrangementObservations(observation1, observation2) {
    observation1.observationResource.related = [{
        type: "sequel-to",
        target: {
            reference: "Observation/" + observation2.getObservationId(),
            display: "Other region/gene involved in rearrangement"
        }
    }];
    observation2.observationResource.related = [{
        type: "sequel-to",
        target: {
            reference: "Observation/" + observation1.getObservationId(),
            display: "Other region/gene involved in rearrangement"
        }
    }];
}

function addVariantReportCopyNumberAlterationSequencesAndObservations(observationArr, sequenceArr, diagnosticReport, specimen, patient, DOM) {
    var copyNumberAlterations = DOM.getElementsByTagName("copy-number-alteration");
    var date = diagnosticReport.getReportDate();
    var reportId = diagnosticReport.getDiagnosticReportId();
    // Might need to account for more than 1 sample
    var nucleicAcidType = DOM.getElementsByTagName("sample")[0].getAttribute("nucleic-acid-type");
    var l = copyNumberAlterations.length;
    for(var i = 0; i < l; i++) {
        observationAndSequenceAddCopyNumberAlterationInfo(observationArr, sequenceArr, copyNumberAlterations[i], nucleicAcidType, date, specimen, patient, reportId, i+1);
    }
}

function observationAndSequenceAddCopyNumberAlterationInfo(observationArr, sequenceArr, copyNumberAlt, nucleicAcidType, date, specimen, patient, reportId, variantNumber) {
    var sequence = foundationFhirSequence();
    sequenceAddCopyNumberAlterationId(sequence.sequenceResource, reportId, variantNumber);
    sequenceCopyNumberAlterationAddStructureVariantFromFoundation(sequence.sequenceResource, copyNumberAlt);
    sequenceAddReferenceToSpecimen(sequence.sequenceResource, specimen.getSpecimenId(), specimen.getSpecimenType());
    sequenceAddTypeFromFoundation(sequence.sequenceResource, nucleicAcidType);
    sequenceAddRefSeqChromosome(sequence.sequenceResource, copyNumberAlt);
    addPatientSubjectReference(sequence.sequenceResource, patient.getPatientId(), patient.getPatientFullName());
    addFoundationAsPerformer(sequence.sequenceResource);
    sequenceArr.push(sequence);

    var observation = foundationFhirObservation();
    addCopyNumberAlterationId(observation.observationResource, reportId, variantNumber);
    variantReportAddGeneNameFromFoundation(observation.observationResource, copyNumberAlt);
    variantReportAddReferenceToSequence(observation.observationResource, sequence.getSequenceId());
    addCopyNumberAlterationEventFromFoundation(observation.observationResource, copyNumberAlt);
    variantReportAddSequenceVariantType(observation.observationResource, copyNumberAlt);
    singleObservationAddDateTimeFromFoundation(observation.observationResource, date);
    observationAddReferenceToSpecimen(observation.observationResource, specimen.getSpecimenId(), specimen.getSpecimenType());
    addPatientSubjectReference(observation.observationResource, patient.getPatientId(), patient.getPatientFullName());
    addFoundationAsPerformer(observation.observationResource);
    observationArr.push(observation);
}

function singleObservationAddDateTimeFromFoundation(observationResource, date) {
    observationResource.effectiveDateTime = date;
}

function addCopyNumberAlterationId(observationResource, reportId, variantNumber) {
    observationResource.id = reportId + "-copy-number-alt-" + variantNumber;
}

function addRearrangementId(observationResource, reportId, variantNumber, ext) {
    observationResource.id = reportId + "-rearrangement-" + ext + "-" + variantNumber;
}

function addCopyNumberAlterationEventFromFoundation(observationResource, copyNumberAlt) {
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsCopyNumberEvent",
        valueCodeableConcept: {
            text: "Copy number: " + copyNumberAlt.getAttribute("copy-number")
        }
    });
}

function variantReportAddSequenceVariantType(observationResource, element) {
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsDNASequenceVariantType",
        valueCodeableConcept: {
            text: element.getAttribute("type")
        }
    });
}

function sequenceRearrangementAddStructureVariantFromFoundation(sequenceResource, rearrangement, attribute) {
    var position = rearrangement.getAttribute(attribute).split(":")[1].split("-");
    sequenceResource.structureVariant = [{
        precisionOfBoundaries: rearrangement.getAttribute("status") + " structural variant. There are " +
            rearrangement.getAttribute("supporting-read-pairs") + " supporting read pairs.",
        length: parseInt(position[1]) - parseInt(position[0]),
        outer: {
            start: position[0],
            end: position[1]
        },
        inner: {
            start: position[0],
            end: position[1]
        }
    }];
}

function sequenceCopyNumberAlterationAddStructureVariantFromFoundation(sequenceResource, copyNumberAlt) {
    var position = copyNumberAlt.getAttribute("position").split(":")[1].split("-");
    sequenceResource.structureVariant = [{
        precisionOfBoundaries: copyNumberAlt.getAttribute("status") + " structural variant",
        reportedaCGHRatio: copyNumberAlt.getAttribute("ratio"),
        length: parseInt(position[1]) - parseInt(position[0]),
        outer: {
            start: position[0],
            end: position[1]
        },
        inner: {
            start: position[0],
            end: position[1]
        }
    }];
}

function addVariantReportShortVariantSequencesAndObservations(observationArr, sequenceArr, diagnosticReport, specimen, patient, DOM) {
    var shortVariants = DOM.getElementsByTagName("short-variant");
    var date = diagnosticReport.getReportDate();
    var reportId = diagnosticReport.getDiagnosticReportId();
    // Might need to account for more than 1 sample
    var nucleicAcidType = DOM.getElementsByTagName("sample")[0].getAttribute("nucleic-acid-type");
    var l = shortVariants.length;
    for(var i = 0; i < l; i++) {
        observationAndSequenceAddShortVariantInfo(observationArr, sequenceArr, shortVariants[i], nucleicAcidType, date, specimen, patient, reportId, i+1);
    }
}

function observationAndSequenceAddShortVariantInfo(observationArr, sequenceArr, shortVariant, nucleicAcidType, date, specimen, patient, reportId, variantNumber) {
    var observation = foundationFhirObservation();
    addShortVariantId(observation.observationResource, reportId, variantNumber);

    var sequence = foundationFhirSequence();
    sequenceAddShortVariantId(sequence.sequenceResource, reportId, variantNumber);
    sequenceShortVariantAddCoverageFromFoundation(sequence.sequenceResource, shortVariant);
    sequenceAddRefSeqChromosome(sequence.sequenceResource, shortVariant);
    sequenceShortVariantAddVariantFromFoundation(sequence.sequenceResource, shortVariant, observation.getObservationId());
    sequenceAddReferenceToSpecimen(sequence.sequenceResource, specimen.getSpecimenId(), specimen.getSpecimenType());
    sequenceAddTypeFromFoundation(sequence.sequenceResource, nucleicAcidType);
    addPatientSubjectReference(sequence.sequenceResource, patient.getPatientId(), patient.getPatientFullName());
    addFoundationAsPerformer(sequence.sequenceResource);
    sequenceArr.push(sequence);

    addShortVariantTranscriptIdFromFoundation(observation.observationResource, shortVariant);
    addShortVariantAlleleFrequencyFromFoundation(observation.observationResource, shortVariant);
    variantReportAddGeneNameFromFoundation(observation.observationResource, shortVariant);
    addShortVariantAminoAcidChangeFromFoundation(observation.observationResource, shortVariant);
    addShortVariantAminoAcidTypeFromFoundation(observation.observationResource, shortVariant);
    addShortVariantDnaSequenceVariantName(observation.observationResource, shortVariant);
    addShortVariantDnaSequenceVariantType(observation.observationResource, shortVariant);
    variantReportAddReferenceToSequence(observation.observationResource, sequence.getSequenceId());
    singleObservationAddDateTimeFromFoundation(observation.observationResource, date);
    observationAddReferenceToSpecimen(observation.observationResource, specimen.getSpecimenId(), specimen.getSpecimenType());
    addPatientSubjectReference(observation.observationResource, patient.getPatientId(), patient.getPatientFullName());
    addFoundationAsPerformer(observation.observationResource);
    observationArr.push(observation);
}

function addShortVariantId(observationResource, reportId, variantNumber) {
    observationResource.id = reportId + "-short-variant-" + variantNumber;
}

function variantReportAddReferenceToSequence(observationResource, sequenceId) {
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsSequence",
        valueReference: {
            reference: "Sequence/" + sequenceId,
            display: "A short variant from a Foundation Medicine variant-report"
        }
    });
}

function addShortVariantDnaSequenceVariantName(observationResource, shortVariant) {
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsDNASequenceVariantName",
        valueCodeableConcept: {
            text: shortVariant.getAttribute("cds-effect")
        }
    });
}

function addShortVariantDnaSequenceVariantType(observationResource, shortVariant) {
    var variant = shortVariant.getAttribute("cds-effect");
    if (variant.includes(">") || variant.includes("<")) {
        var type = "substitution";
    }
    if (variant.includes("del")) {
        type = "deletion";
    }
    if (variant.includes("ins")) {
        type = "insertion";
    }
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsDNASequenceVariantType",
        valueCodeableConcept: {
            text: type
        }
    });
}

function addShortVariantAminoAcidTypeFromFoundation(observationResource, shortVariant) {
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsAminoAcidChangeType",
        valueCodeableConcept: {
            text: shortVariant.getAttribute("functional-effect")
        }
    });
}

function addShortVariantAminoAcidChangeFromFoundation(observationResource, shortVariant) {
    observationResource.extension.push({
       url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsAminoAcidChange",
        valueCodeableConcept: {
            text: shortVariant.getAttribute("protein-effect")
        }
    });
}

function addRearrangementGeneNameFromFoundation(observationResource, element, attribute) {
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsGene",
        valueCodeableConcept: {
            text: element.getAttribute(attribute)
        }
    });
}

function variantReportAddGeneNameFromFoundation(observationResource, element) {
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsGene",
        valueCodeableConcept: {
            text: element.getAttribute("gene")
        }
    });
}

function addShortVariantAlleleFrequencyFromFoundation(observationResource, shortVariant) {
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsAllelicFrequency",
        valueDecimal: shortVariant.getAttribute("allele-fraction")
    })
}

//Not part of DSTU3
function addShortVariantTranscriptIdFromFoundation(observationResource, shortVariant) {
    observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsTranscriptReferenceSequenceId",
        valueCodeableConcept: {
            text: shortVariant.getAttribute("transcript")
        }
    });
}

function sequenceAddShortVariantId(sequenceResource, reportId, variantNumber) {
    sequenceResource.id = reportId + "-short-variant-" + variantNumber + "-seq";
}

function sequenceAddCopyNumberAlterationId(sequenceResource, reportId, variantNumber) {
    sequenceResource.id = reportId + "-copy-number-alt-" + variantNumber + "-seq";
}

function sequenceAddRearrangementId(sequenceResource, reportId, variantNumber, ext) {
    sequenceResource.id = reportId + "-rearrangement-" + ext + "-" + variantNumber + "-seq";
}

function sequenceAddTypeFromFoundation(sequenceResource, nucleicAcidType) {
    sequenceResource.type = nucleicAcidType;
}

function sequenceRearrangementAddRefSeqChromosome(sequenceResource, element, attribute) {
    sequenceResource.referenceSeq = {
        chromosome: {
            text: element.getAttribute(attribute).split(":")[0]
        }
    };
}

function sequenceAddRefSeqChromosome(sequenceResource, element) {
    sequenceResource.referenceSeq = {
        chromosome: {
            text: element.getAttribute("position").split(":")[0]
        }
    };
}

function sequenceAddReferenceToSpecimen(sequenceResource, specimenId, specimenType) {
    sequenceResource.specimen = {
        reference: "Specimen/" + specimenId,
        display: specimenType
    }
}

function sequenceShortVariantAddVariantFromFoundation(sequenceResource, shortVariant, observationId) {
    var position = shortVariant.getAttribute("position").split(":")[1];
    var variant = shortVariant.getAttribute("cds-effect");
    if(variant.includes(">")){
        variant = shortVariant.getAttribute("cds-effect").replace(/[0-9a-z&]/g, '').split(">");
    }
    if(variant.includes("<")) {
        variant = shortVariant.getAttribute("cds-effect").replace(/[0-9a-z&]/g, '').split("<");
    }
    if(variant.includes("ins")) {
        variant = [shortVariant.getAttribute("cds-effect").replace(/[0-9a-z&]/g, '').split("_")[1], "_"];
    }
    if(variant.includes("del")) {
        variant = ["_", shortVariant.getAttribute("cds-effect").replace(/[0-9a-z&]/g, '').split("_")[1]];
    }
    sequenceResource.variant = [{
        start: position,
        end: position,
        observedAllele: variant[0],
        referenceAllele: variant[1],
        variantPointer: {
            reference: "Observation/" + observationId,
            display: "Genetic observation that contains information on this variant"
        }
    }];
}

function sequenceShortVariantAddCoverageFromFoundation(sequenceResource, shortVariant) {
    sequenceResource.readCoverage = shortVariant.getAttribute("depth");

}

function foundationFhirProvenance() {
    return {
      provenanceResource: {
          resourceType: "Provenance",
          activity: {
              system: "http://hl7.org/fhir/v3/DocumentCompletion",
              code: "LA",
              display: "legally authenticated"
          }
      },
        getProvenanceId: function() {
          return this.provenanceResource.id;
        },
        getRecordedTime: function() {
            return this.provenanceResource.recorded;
        },
        getSignaturesArray: function() {
          return this.provenanceResource.signature;
        },
        resourceType: "Provenance"
    };
}

function provenanceAddAgentFromFoundation(provenanceResource, practitionerIdsAndNames) {
    provenanceResource.agent = [];
    var l = practitionerIdsAndNames.length;
    for(var i = 0; i < l; i++) {
        provenanceResource.agent.push({
            role: {
                system: "http://hl7.org/fhir/ValueSet/provenance-agent-role",
                code: "attester",
                display: "Foundation Medicine Medical Doctor that signed off on the report."
            },
            whoReference: {
                reference: practitionerIdsAndNames[i].id,
                display: practitionerIdsAndNames[i].name
            },
            onBehalfOfReference: {
                reference: "Organization/FM",
                display: "Foundation Medicine"
            }
        });
    }
}

function foundationPractitionerAsserters() {
    return {
        practitioners: {
            "Jo-Anne Vergilio": {
                resourceType: "Practitioner",
                id: "Vergilio-FM",
                name: [{
                    use: "official",
                    text: "Jo-Anne Vergilio",
                    family: "Vergilio",
                    given: ["Jo-Anne"],
                    prefix: ["M.D."]
                }],
                gender: "female"
            },
            "Jeffrey S. Ross": {
                resourceType: "Practitioner",
                id: "Ross-FM",
                name: [{
                    use: "official",
                    text: "Jeffrey S. Ross",
                    family: "Ross",
                    given: ["Jeffrey", "S."],
                    prefix: ["M.D.", "Medical Director"]
                }],
                gender: "male"
            },
            "Shakti Ramkissoon": {
                resourceType: "Practitioner",
                id: "Ramkissoon-FM",
                name: [{
                    use: "official",
                    text: "Shakti Ramkissoon",
                    family: "Ramkissoon",
                    given: ["Shakti"],
                    prefix: ["M.D."]
                }],
                gender: "male"
            }
        },
        resourceType: "Practitioner",
        numberOfPractitioners: 3
    }
}

function provenanceAddId(provenanceResource, diagnosticReportId) {
    provenanceResource.id = diagnosticReportId + "-provenance-1";
}

function provenanceAddSignaturesFromFoundation(provenanceResource, foundationPractitionerAsserters, recordedTime, DOM) {
    var names = [];
    names.push(DOM.getElementsByTagName("OpName")[0].childNodes[0].nodeValue.trim());
    var namesFromText = DOM.getElementsByTagName("Text")[0].childNodes[0].nodeValue.split("|");
    var l = namesFromText.length;
    for(var i = 0; i < l; i++) {
        var name = namesFromText[i].split(",")[0].trim();
        if(names.indexOf(name) == -1) {
            names.push(name);
        }
    }
    provenanceResource.signature = [];
    var nNames = names.length;
    for(i = 0; i < nNames; i++) {
        var practitionerAsserterResource = foundationPractitionerAsserters.practitioners[names[i]];
        provenanceResource.signature.push({
            type: [{
                system: "http://hl7.org/fhir/ValueSet/signature-type",
                code: "1.2.840.10065.1.12.1.6",
                display: "Validation Signature"
            }],
            when: recordedTime,
            whoReference: {
                reference: "Practitioner/" + practitionerAsserterResource.id,
                display: practitionerAsserterResource.name[0].text
            },
            onBehalfOfReference: {
                reference: "Organization/FM",
                display: "Foundation Medicine"
            }
        });
    }
}

function provenanceAddRecordedTimeFromFoundation(provenanceResource, DOM) {
    provenanceResource.recorded = DOM.getElementsByTagName("ServerTime")[0].childNodes[0].nodeValue.replace(" ", "T");
}

function provenanceAddTargetResources(provenanceResource, diagnosticReportId, diagnosticReportDisplay, observationArr) {
    provenanceResource.target = [];
    provenanceResource.target.push({
        reference: "DiagnosticReport/" + diagnosticReportId,
        display: diagnosticReportDisplay
    });

    var l = observationArr.length;
    for(var i = 0; i < l; i++) {
        provenanceResource.target.push({
           reference: "Observation/" + observationArr[i].observationResource.id,
            display: observationArr[i].getDisplayString()
        });
    }
}

//Initialize a FHIR procedureRequest object to be built by a Foundation XML file
function foundationFhirProcedureRequest() {
    return {
        procedureRequestResource: {
            resourceType: "ProcedureRequest",
            status: "completed",
            intent: "order"
        },
        getProcedureRequestId: function() {
          return this.procedureRequestResource.id;
        },
        getProcedureRequestNote: function () {
          return this.procedureRequestResource.note;
        },
        resourceType: "ProcedureRequest"
    };
}

function procedureRequestAddId(procedureRequestResource, diagnosticReportId) {
    procedureRequestResource.id = diagnosticReportId + "-request-1";
}

function procedureRequestAddNote(procedureRequestResource, diagnosticReportTestPerformed) {
    procedureRequestResource.note =[{
        text: "This is a request for a " + diagnosticReportTestPerformed
    }];
}

function procedureRequestAddRequester(procedureRequestResource, orderingPhysician, organization) {
    procedureRequestResource.requester = {
        agent: {
            reference: "Practitioner/" + orderingPhysician.getPractitionerId(),
            display: orderingPhysician.getPractitionerId()
        },
        onBehalfOf: {
            reference: "Organization/" + organization.getOrganizationId(),
            display: organization.getOrganizationName()
        }
    };
}

function procedureRequestAddreasonReference(procedureRequestResource, conditionId, condition) {
    procedureRequestResource.reasonReference = [{
        reference: "Condition/" + conditionId,
        display: condition
    }];
}

//Initialize a FHIR specimen object to be built by a Foundation XML file
function foundationFhirSpecimen() {
    return {
        specimenResource: {
            resourceType: "Specimen",
            status: "available",
            collection: {}
        },
        getSpecimenType: function () {
            return this.specimenResource.type.text;
        },
        getSpecimenId: function () {
            return this.specimenResource.id;
        },
        getSpecimenCollectionDate: function () {
            return this.collection.collectedDateTime;
        },
        getSpecimenBodySite: function () {
            return this.collection.bodySite.text;
        },
        getSpecimenCollector: function() {
          return this.collection.collector.display;
        },
        resourceType: "Specimen"
    };
}

function specimenAddId(specimenResource, DOM) {
    specimenResource.id = DOM.getElementsByTagName("SampleId")[0].childNodes[0].nodeValue;
}

function specimenAddPathologistAsCollector(specimenResource, pathologistID, pathologistName) {
    specimenResource.collection.collector = {
        reference: "Practitioner/" + pathologistID,
        display: pathologistName
    };
}

function specimenAddNoteFromFoundation(specimenResource, DOM) {
    var applicationSetting = DOM.getElementsByTagName("ApplicationSetting");
    if(applicationSetting[0].getElementsByTagName("Value")[0].childNodes[0] == undefined) {
        var statement = "";
    }
    else {
        statement = applicationSetting[0].getElementsByTagName("Value")[0].childNodes[0].nodeValue;
    }
    specimenResource.note = [{
        authorString: "Foundation Medicine",
        time: DOM.getElementsByTagName("CollDate")[0].childNodes[0].nodeValue,
        text: statement
    }]
}


function specimenAddCollectionInfoFromFoundation(specimenResource, DOM) {
    specimenResource.collection.collectedDateTime = DOM.getElementsByTagName("CollDate")[0].childNodes[0].nodeValue;
    specimenResource.collection.bodySite = {
        coding: [],
        text: DOM.getElementsByTagName("SpecSite")[0].childNodes[0].nodeValue
    }
}

function specimenAddRequestReference(specimenResource, resourceID, resourceText) {
    specimenResource.request = [{
        reference: "ProcedureRequest/" + resourceID,
        display: resourceText
    }];
}

function specimenAddReceivedTimeFromFoundation(specimenResource, DOM) {
    specimenResource.receivedTime = DOM.getElementsByTagName("ReceivedDate")[0].childNodes[0].nodeValue
}

function specimenAddTypeFromFoundation(specimenResource, DOM) {
    specimenResource.type = {
        coding: [],
        text: DOM.getElementsByTagName("SpecFormat")[0].childNodes[0].nodeValue + " from " +
        DOM.getElementsByTagName("SpecSite")[0].childNodes[0].nodeValue
    }
}

//Initialize a FHIR relatedArtifact object to be built by a literature reference in a Foundation XML file
function foundationFhirRelatedArtifact() {
    return {
        relatedArtifactResource: {
            resourceType: "RelatedArtifact",
            type: "citation"
        },
        resourceType: "RelatedArtifact"
    };
}

//Initialize a FHIR observation object to be built by a Foundation XML file
function foundationFhirObservation() {
    return {
        observationResource: {
            resourceType: "Observation",
            text: {
                status: "generated",
                div: ""
            },
            status: "final",
            category: [{
                coding: [{
                    system: "http://hl7.org/fhir/observation-category",
                    code: "laboratory"
                }],
                text: "Laboratory result generated by Foundation Medicine"
            }],
            //extension is where all of the genomic fields of the observation will be stored
            extension: [],
            performer: [{
                reference: "Organization/FM",
                display: "Foundation Medicine"
            }]
        },
        getReferencePatientName: function () {
            return this.observationResource.subject.display;
        },
        getObservationId: function () {
            return this.observationResource.id;
        },
        getDisplayString: function () {
            return this.display;
        },
        resourceType: "Observation",
        related: []
    };
}

function observationAddReferenceToSpecimen(observationResource, specimenId, specimenType) {
    observationResource.specimen = {
        reference: "Specimen/" + specimenId,
        display: specimenType
    };
}

function observationAddGenomicInfoFromFoundation(observationArr, specimenId, specimenType, DOM) {
    var genesDOM = DOM.getElementsByTagName("Genes")[0];
    var trackerObj = {value: 0},
        genes = {};
    extractGenomicInfoInOrder(observationArr, genesDOM, genes, specimenId, specimenType, trackerObj);
    extractRelatedClinicalTrials(observationArr, DOM, genes, trackerObj);
}

function extractGenomicInfoInOrder(observationArr, genesDOM, genes, specimenId, specimenType, tracker) {
    var geneDOMs = genesDOM.getElementsByTagName("Gene");
    //keep track of what index the genes are in the observation array to relate them to their suggested clinical trials
    var l = geneDOMs.length;
    //same therapy can be applied to > 1 genomic alteration
    var therapies = [],
        therapyDict = {};
    for (var i = 0; i < l; i++) {
        var gene = geneDOMs[i].getElementsByTagName("Name")[0].childNodes[0].nodeValue;
        genes[gene + "-idNumber"] = (i + 1);
        genes[gene + "-trackerNumber"] = tracker.value;
        observationArr[tracker.value].observationResource.id = observationArr[tracker.value].relatedReportId + "-gene-alt-" + (i + 1);
        observationArr[tracker.value].observationResource.extension.push({
            url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsGene",
            valueCodeableConcept: {
                coding: [{
                    system: "http://www.genenames.org",
                    display: gene
                }],
                text: gene
            }
        });
        var alterationDOM = geneDOMs[i].getElementsByTagName("Alteration");
        var alteration = alterationDOM[0].getElementsByTagName("Name")[0].childNodes[0].nodeValue;
        if (hasNumber(alteration)) {
            observationAddAminoAcidChangeFromFoundation(observationArr, alteration, tracker);
        }
        else {
            observationAddSequenceVariantTypeFromFoundation(observationArr, alteration, tracker);
        }
        observationAddGeneticsInterpretation(observationArr, alterationDOM[0].getElementsByTagName("Interpretation")[0].childNodes[0].nodeValue, tracker);
        observationAddReferenceToSpecimen(observationArr[tracker.value].observationResource, specimenId, specimenType);
        observationArr[tracker.value].observationResource.related = [];
        observationArr[tracker.value].display = "A genomic alteration in " + gene;

        var geneWithAlt = gene + " - " + alteration;
        geneGrabRelatedArtifactsReferenceId(geneDOMs[i], observationArr[tracker.value].observationResource.id,
            observationArr[tracker.value].display, observationArr[tracker.value].observationResource.extension);

        var geneIndex = JSON.parse(JSON.stringify(tracker));
        tracker.value = tracker.value + 1;
        /*** will also want to pass in the alteration with the gene, instead of just the gene ***/
        extractRelatedTherapies(observationArr, geneDOMs[i], gene, tracker, therapies, therapyDict, geneIndex);
    }
}

function geneGrabRelatedArtifactsReferenceId(geneDOM, observationId, observationName, observationExtension) {
    var nTherapyReferenceLinks = geneDOM.getElementsByTagName("Therapy").length;
    var references = geneDOM.getElementsByTagName("ReferenceLinks")[nTherapyReferenceLinks];
    references = references.getElementsByTagName("ReferenceLink");
    var l = references.length;
    for(var i = 0; i < l; i++) {
        addRelatedArtifacts(observationId, references[i], observationName, observationExtension);
    }
}

function addRelatedArtifacts(observationId, reference, observationName, observationExtension) {
    // NOTE: anything pertaining to the artifact is actual relatedArtifact structure (http://build.fhir.org/metadatatypes.html#RelatedArtifact)
    // what we are actually pushing is PubMed url in extension structure form
    var referenceId = reference.getAttribute("referenceId");
    var artifact = foundationFhirRelatedArtifact();
    artifact.relatedArtifactResource.display = "Published literature pertaining to " + observationName +
        " from PubMed.";
    artifact.relatedArtifactResource.citation = "PubMed ID: " + referenceId;
    artifact.relatedArtifactResource.url = "https://www.ncbi.nlm.nih.gov/pubmed/" + referenceId;
    artifact.relatedArtifactResource.resource = {
        reference: "Observation/" + observationId,
        //display: add display string here.. going to need to pass in entire observation object
    };
    observationExtension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-relatedPubMedArtifact",
        valueCodeableConcept: {
            text: artifact.relatedArtifactResource.url
        }
    });
}

function observationAddGeneticsInterpretation(observationArr, interpretation, tracker) {
    observationArr[tracker.value].observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsInterpretation",
        valueCodeableConcept: {
            text: interpretation
        }
    });
}

//Only use this function when no specific amino acid change (i.e. amplification-equivocal)
function observationAddSequenceVariantTypeFromFoundation(observationArr, alteration, tracker) {
    observationArr[tracker.value].observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsDNASequenceVariantType",
        valueCodeableConcept: {
            text: alteration
        }
    });
}

function observationAddAminoAcidChangeFromFoundation(observationArr, alteration, tracker) {
    observationArr[tracker.value].observationResource.extension.push({
        url: "http://hl7.org/fhir/StructureDefinition/observation-geneticsAminoAcidChangeName",
        valueCodeableConcept: {
            text: alteration
        }
    });
}

function extractRelatedClinicalTrials(observationArr, trialsDOM, genes, tracker) {
    var usedTrials = [];
    var trialsDict = {};
    var trialDOMs = trialsDOM.getElementsByTagName("Trial");
    var l = trialDOMs.length;
    var trialNumber = 1;

    for (var i = 0; i < l; i++) {
        var title = trialDOMs[i].getElementsByTagName("Title")[0].childNodes[0].nodeValue;
        var relatedGene = trialDOMs[i].getElementsByTagName("Gene")[0].childNodes[0].nodeValue;
        if(usedTrials.indexOf(title) != -1) {
            observationArr[genes[relatedGene + "-trackerNumber"]].related.push({
                target: {
                    reference: "Observation/" + observationArr[trialsDict[title]].observationResource.id,
                    display: "A clinical trial suggested as a result of the genomic alteration"
                }
            });
            observationArr[trialsDict[title]].related.push({
                type: "derived-from",
                target: {
                    reference: "Observation/" + observationArr[trialsDict[title]].relatedReportId + "-gene-alt-" + genes[relatedGene + "-idNumber"],
                    display: "Mutation in " + relatedGene
                }
            });
        }
        else {
            var display = "A clinical trial option suggested as a result of the genomic alterations found in patient";
            var string = display + ". The title of the trial is " + title +
                ". This is a " + trialDOMs[i].getElementsByTagName("StudyPhase")[0].childNodes[0].nodeValue + " clinical trial study. " +
                "It targets " + trialDOMs[i].getElementsByTagName("Target")[0].childNodes[0].nodeValue +
                ". The locations this clinical trial is available in are: " +
                trialDOMs[i].getElementsByTagName("Locations")[0].childNodes[0].nodeValue + ". The NCT ID for this trial is: " +
                trialDOMs[i].getElementsByTagName("NCTID")[0].childNodes[0].nodeValue;
            observationArr[tracker.value].observationResource.id = observationArr[tracker.value].relatedReportId + "-trial-" + trialNumber;
            trialNumber = trialNumber + 1;
            observationArr[tracker.value].observationResource.valueString = string;
            observationArr[tracker.value].observationResource.comment = trialDOMs[i].getElementsByTagName("Note")[0].childNodes[0].nodeValue;
            observationArr[tracker.value].related = [{
                type: "derived-from",
                target: {
                    reference: "Observation/" + observationArr[tracker.value].relatedReportId + "-gene-alt-" + genes[relatedGene + "-idNumber"],
                    display: "Mutation in " + relatedGene
                }
            }];
            observationArr[genes[relatedGene + "-trackerNumber"]].related.push({
                target: {
                    reference: "Observation/" + observationArr[tracker.value].observationResource.id,
                    display: "A clinical trial suggested as a result of the genomic alteration"
                }
            });
            observationArr[tracker.value].display = display;
            trialsDict[title] = parseInt(tracker.value);
            usedTrials.push(title);
            tracker.value = tracker.value + 1;
        }
    }
}

function extractRelatedTherapies(observationArr, geneDOM, gene, tracker, therapiesUsed, therapyDict, geneIndex) {
    var therapyDOMs = geneDOM.getElementsByTagName("Therapy");
    var l = therapyDOMs.length;
    var therapyNumber = 1;
        for (var i = 0; i < l; i++) {
            var therapy = therapyDOMs[i].getElementsByTagName("Name")[0].childNodes[0].nodeValue;
            if (therapiesUsed.indexOf(therapy) != -1) {
                observationArr[parseInt(geneIndex.value)].related.push({
                    target: {
                        reference: "Observation/" + observationArr[therapyDict[therapy]].observationResource.id,
                        display: observationArr[therapyDict[therapy]].display
                    }
                });
                observationArr[therapyDict[therapy]].related.push({
                    type: "derived-from",
                    target: {
                        reference: "Observation/" + observationArr[parseInt(geneIndex.value)].observationResource.id,
                        display: "Mutation in " + gene
                    }
                });
            }
            else {
                if (therapyDOMs[i].getElementsByTagName("Effect")[0].childNodes[0].nodeValue.toLowerCase() == "sensitizing") {
                    var display = therapy + " is a therapy associated with potential clinical benefit";
                    var string = display + ". " + "This therapy was observed as a potential treatment for the patient due to their mutation in " +
                        gene + ". FDA Approved: " + therapyDOMs[i].getElementsByTagName("FDAApproved")[0].childNodes[0].nodeValue;
                }
                else {
                    display = therapy + " is a therapy associated with a lack of response. ";
                    string = display + "This therapy was observed as a potential treatment for the patient due to their mutation in " +
                        gene + ". FDA Approved: " + therapyDOMs[i].getElementsByTagName("FDAApproved")[0].childNodes[0].nodeValue;
                }
                observationArr[tracker.value].observationResource.id = observationArr[tracker.value].relatedReportId + "-therapy-" + therapyNumber;
                therapyNumber = therapyNumber + 1;
                observationArr[tracker.value].observationResource.valueString = string;
                observationArr[tracker.value].observationResource.comment = therapyDOMs[i].getElementsByTagName("Rationale")[0].childNodes[0].nodeValue;
                observationArr[tracker.value].related = [{
                    type: "derived-from",
                    target: {
                        reference: "Observation/" + observationArr[tracker.value - (i + 1)].observationResource.id,
                        display: "Mutation in " + gene
                    }
                }];
                observationArr[tracker.value - (i + 1)].related.push({
                    target: {
                        reference: "Observation/" + observationArr[tracker.value].observationResource.id,
                        display: display
                    }
                });
                observationArr[tracker.value].display = display;
                therapyDict[therapy] = parseInt(tracker.value);
                therapiesUsed.push(therapy);
                therapyGrabRelatedArtifactsReferenceId(therapyDOMs[i], observationArr[tracker.value].observationResource.id,
                    display, observationArr[tracker.value].observationResource.extension);
                tracker.value = tracker.value + 1;
            }
        }
}

function therapyGrabRelatedArtifactsReferenceId(therapyDOM, observationId, observationName, observationExtension) {
    var references = therapyDOM.getElementsByTagName("ReferenceLink");
    var l = references.length;
    for(var i = 0; i < l; i++) {
        addRelatedArtifacts(observationId, references[i], observationName, observationExtension);
    }
}

function observationAddEffectiveDateTimeFromFoundation(observationArr, date) {
    var l = observationArr.length;
    for (var i = 0; i < l; i++) {
        observationArr[i].observationResource.effectiveDateTime = date;
    }
}

function addPatientSubjectReferenceToObservations(observationArr, patientId, patientName) {
    var l = observationArr.length;
    for (var i = 0; i < l; i++) {
        observationArr[i].observationResource.subject = {
            reference: "Patient/" + patientId,
            display: patientName
        };
    }
}

function addReportIdToObservationObj(observationArr, reportId) {
    var l = observationArr.length;
    for (var i = 0; i < l; i++) {
        observationArr[i].relatedReportId = reportId;
    }
}

function initObservations(observationArr, nObservations) {
    for (var i = 0; i < nObservations; i++) {
        observationArr[i] = foundationFhirObservation();
    }
}

//Initialize a FHIR diagnosticReport object to be built by a Foundation XML file
function foundationFhirDiagnosticReport() {
    return {
        diagnosticReportResource: {
            resourceType: "DiagnosticReport",
            text: {
                status: "generated",
                div: ""
            },
            status: "partial",
            code: {
                text: "FoundationOne"
            }
        },
        observationsInReport: 0,
        getObservationsInReportCount: function () {
            return this.observationsInReport;
        },
        getReportDate: function () {
            return this.diagnosticReportResource.effectiveDateTime;
        },
        getReferencePatientName: function () {
            return this.diagnosticReportResource.subject.display;
        },
        getNameOfDiagnosticReport: function () {
            return this.diagnosticReportResource.code.text;
        },
        getConclusionOfDiagnosisReport: function () {
            return this.diagnosticReportResource.conclusion;
        },
        getDiagnosticReportId: function () {
            return this.diagnosticReportResource.id;
        },
        getDiagnosticReportTestPerformed: function () {
         return this.diagnosticReportResource.category.text;
        },
        resourceType: "DiagnosticReport"
    };
}

function diagnosticReportAddContainedArr(diagnosticReportResource, observationArr, specimen) {
    diagnosticReportResource.contained = [];
    var l = observationArr.length;
    for(var i = 0; i < l; i++) {
        diagnosticReportResource.contained.push(observationArr[i].observationResource);
    }
    diagnosticReportResource.contained.push(specimen.specimenResource);
}

function diagnosticReportAddConclusionFromFoundation(diagnosticReport, DOM) {
    var summary = DOM.getElementsByTagName("Summaries")[0];
    var alterationCount = parseInt(summary.getAttribute("alterationCount")),
        sensitizingCount = parseInt(summary.getAttribute("sensitizingCount")),
        resistiveCount = parseInt(summary.getAttribute("resistiveCount")),
        clinicalTrialCount = parseInt(summary.getAttribute("clinicalTrialCount"));

    var applicationSetting = DOM.getElementsByTagName("ApplicationSetting");
    if(applicationSetting[0].getElementsByTagName("Value")[0].childNodes[0] == undefined) {
        var statement = "";
    }
    else {
        statement = applicationSetting[0].getElementsByTagName("Value")[0].childNodes[0].nodeValue;
    }

    diagnosticReport.diagnosticReportResource.conclusion = "Patient results: " + alterationCount +
        " genomic alterations | " + sensitizingCount + " therapies associated with potential clinical benefit | " +
        resistiveCount + " therapies associated with lack of response | " + clinicalTrialCount + " clinical trials. " +
        statement;
    diagnosticReport.observationsInReport = alterationCount + sensitizingCount + resistiveCount + clinicalTrialCount;
}

function diagnosticReportReferenceObservations(diagnosticReportResource, observationArr) {
    diagnosticReportResource.result = [];
    var l = observationArr.length;
    for (var i = 0; i < l; i++) {
        diagnosticReportResource.result[i] = {
            reference: "Observation/" + observationArr[i].getObservationId(),
            display: observationArr[i].getDisplayString()
        };
    }
}

function addSpecimenReference(resource, specimenId, specimenType) {
    resource.specimen = [{
        reference: "Specimen/" + specimenId,
        display: specimenType
    }];
}

function diagnosticReportAddEffectiveDateTimeFromFoundation(diagnosticReportResource, DOM) {
    diagnosticReportResource.effectiveDateTime = DOM.getElementsByTagName("CollDate")[0].childNodes[0].nodeValue;
}

function diagnosticReportAddCategoryFromFoundation(diagnosticReportResource, DOM) {
    diagnosticReportResource.category = {
        text: DOM.getElementsByTagName("TestType")[0].childNodes[0].nodeValue + " test by Foundation Medicine"
    };
}

function diagnosticReportAddId(diagnosticReportResource, DOM) {
    diagnosticReportResource.id = DOM.getElementsByTagName("ReportId")[0].childNodes[0].nodeValue + "v" +
        DOM.getElementsByTagName("Version")[0].childNodes[0].nodeValue;
}

//Initialize a FHIR condition object to be built by a Foundation XML file
function foundationFhirCondition() {
    return {
        conditionResource: {
            resourceType: "Condition",
            text: {
                status: "generated",
                div: ""
            },
            verificationStatus: "confirmed",
            category: [{
                coding: [{
                    system: "http://hl7.org/fhir/condition-category",
                    code: "encounter-diagnosis"
                }]
            }],
            severity: {
                coding: [{
                    system: "http://snomed.info/sct",
                    code: "24484000",
                    display: "Severe"
                }]
            }
        },
        getCondition: function () {
            return this.conditionResource.code.text;
        },
        getConditionId: function () {
            return this.conditionResource.id;
        },
        getSubjectName: function () {
            return this.conditionResource.subject.display;
        },
        getSubjectReference: function () {
            return this.conditionResource.subject.reference;
        },
        getConditionBodySite: function () {
            return this.conditionResource.bodySite[0].text;
        },
        getConditionEvidence: function () {
            return this.conditionResource.evidence[0].detail[0].display;
        },
        resourceType: "Condition"
    };
}

function conditionAddEvidenceDetailReference(conditionResource, diagnosticReportId, DOM) {
    conditionResource.evidence = [{}];
    conditionResource.evidence[0].detail = [{
        reference: "DiagnosticReport/" + diagnosticReportId,
        display: "A " + DOM.getElementsByTagName("TestType")[0].childNodes[0].nodeValue + " test performed on " +
        DOM.getElementsByTagName("CollDate")[0].childNodes[0].nodeValue + " by Foundation Medicine"
    }];
}

function conditionAddBodySiteFromFoundation(conditionResource, DOM) {
    conditionResource.bodySite = [{
        text: DOM.getElementsByTagName("variant-report")[0].getAttribute("tissue-of-origin").toLowerCase()
    }];
}

function conditionAddCodeFromFoundation(conditionResource, DOM) {
    conditionResource.code = {
        text: DOM.getElementsByTagName("SubmittedDiagnosis")[0].childNodes[0].nodeValue
    };
}

function conditionAddId(conditionResource, patientId) {
    conditionResource.id = patientId + "-cond-1";
}

//Initialize a FHIR practitioner object to be built by a Foundation XML file
function foundationFhirPractitioner() {
    return {
        practitionerResource: {
            resourceType: "Practitioner",
            text: {
                status: "generated",
                div: ""
            }
        },
        getPractitionerName: function () {
            return this.practitionerResource.name[0].text;
        },
        getPractitionerId: function() {
            return this.practitionerResource.id;
        },
        resourceType: "Practitioner"
    };
}

function practitionerAddRoleFromFoundation(practitionerResource, foundationTag, organization) {
    if (foundationTag == "OrderingMD") {
        var code = "309295000";
        var text = "Physician";
    }
    else {
        code = "81464008";
        text = "Pathologist";
    }
    practitionerResource.role = [{}];
    if(organization != null) {
        practitionerResource.role[0].organization = {
            reference: "Organization/" + organization.getOrganizationId(),
            display: organization.getOrganizationName()
        };
    }
    else {
        practitionerResource.role[0].organization = {};
    }
    practitionerResource.role[0].code = {
        coding: [{
            system: "http://snomed.info/sct",
            code: code
        }],
        text: text
    };
}

function practitionerAddIdFromFoundation(practitionerResource, foundationTag, DOM) {
    var id = DOM.getElementsByTagName(foundationTag)[0].childNodes[0].nodeValue;
    id = id+"FM";
    practitionerResource.id = id;
}

function practitionerAddNameFromFoundation(practitionerResource, foundationTag, DOM) {
    var name = DOM.getElementsByTagName(foundationTag)[0].childNodes[0].nodeValue;
    name = name.split(", ");
    practitionerResource.name = [{}];
    practitionerResource.name[0].given = name[1].split(" ");
    practitionerResource.name[0].family = name[0];
    practitionerResource.name[0].prefix = ["M.D."];
    practitionerResource.name[0].text = practitionerResource.name[0].given.join(" ") +
        " " + practitionerResource.name[0].family + ", " + practitionerResource.name[0].prefix.join(", ");
}

//Initialize a FHIR organization object to be built by a Foundation XML file
function foundationFhirOrganization() {
    return {
        organizationResource: {
            resourceType: "Organization",
            text: {
                status: "generated",
                div: ""
            }
        },
        getOrganizationName: function () {
            return this.organizationResource.name;
        },
        getOrganizationId: function () {
            return this.organizationResource.id;
        },
        resourceType: "Organization"
    };
}

function organizationAddIdFromFoundation(organizationResource, foundationTag, DOM) {
    var id = DOM.getElementsByTagName(foundationTag)[0].childNodes[0].nodeValue;
    id = id+"FM";
    organizationResource.id = id;
}

function organizationAddIdentifierFromFoundation(organizationResource, DOM) {
    organizationResource.identifier = [{
        value: DOM.getElementsByTagName("MedFacilID")[0].childNodes[0].nodeValue
    }];
}

function organizationAddNameFromFoundation(organizationResource, DOM) {
    organizationResource.name = DOM.getElementsByTagName("MedFacilName")[0].childNodes[0].nodeValue;
}

//Initialize a FHIR patient object to be built by a Foundation XML file
function foundationFhirPatient() {
    return {
        patientResource: {
            resourceType: "Patient",
            text: {
                status: "generated",
                div: ""
            },
            deceasedBoolean: false
        },
        getPatientFullName: function () {
            return this.patientResource.name[0].text;
        },
        getPatientFirstName: function () {
            return this.patientResource.name[0].given[0];
        },
        getPatientLastName: function () {
            return this.patientResource.name[0].family;
        },
        getPatientIdentifer: function () {
            return this.patientResource.identifier[0].value;
        },
        getPatientId: function () {
            return this.patientResource.id;
        },
        resourceType: "Patient"
    };
}

function patientAddIdFromFoundation(patientResource, DOM) {
    var id = DOM.getElementsByTagName("MRN")[0].childNodes[0].nodeValue;
    id = id+"FM";
    patientResource.id = id;
}

function patientAddIdentifierFromFoundation(patientResource, DOM) {
    patientResource.identifier = [{}];
    patientResource.identifier[0].use = "usual";
    patientResource.identifier[0].type = {
        coding: [{
            system: "http://hl7.org/fhir/v2/0203",
            code: "MR"
        }]
    };
    patientResource.identifier[0].value = DOM.getElementsByTagName("MRN")[0].childNodes[0].nodeValue;
    patientResource.identifier[0].assigner = {
        display: DOM.getElementsByTagName("MedFacilName")[0].childNodes[0].nodeValue
    };
}

function patientAddBirthDateFromFoundation(patientResource, DOM) {
    patientResource.birthDate = DOM.getElementsByTagName("DOB")[0].childNodes[0].nodeValue;
}

function patientAddGenderFromFoundation(patientResource, DOM) {
    patientResource.gender = DOM.getElementsByTagName("Gender")[0].childNodes[0].nodeValue.toLowerCase();
}

function patientAddNameFromFoundation(patientResource, DOM) {
    patientResource.name = [{}];
    patientResource.name[0].use = "official";
    patientResource.name[0].given = [DOM.getElementsByTagName("FirstName")[0].childNodes[0].nodeValue];
    patientResource.name[0].family = DOM.getElementsByTagName("LastName")[0].childNodes[0].nodeValue;
    patientResource.name[0].text = patientResource.name[0].given[0] + " " + patientResource.name[0].family;
}

function addFoundationAsPerformer(resource) {
    resource.performer = [{
        reference: "Organization/FM",
        display: "Foundation Medicine"
    }];
}

function addPatientSubjectReference(resource, patientId, patientName) {
    resource.subject = {
        reference: "Patient/" + patientId,
        display: patientName
    };
}

function generateDOMParser() {
    var parser = new DOMParser();
    return parser;
}

//check if string has a number in it
function hasNumber(string) {
    return /\d/.test(string);
}


String.prototype.lowerCaseFirstLetter = function () {
    return this.charAt(0).toLowerCase() + this.slice(1);
};

function readFiles(files) {
    for (var i = 0; i < files.length; i++) {
        var fileArr = [];
        (function (file) {
            var reader = new FileReader();
            reader.onload = function (e) {
                var text = e.target.result;
                fileArr.push(text.replace(/\n/g, ""));
            };
            reader.readAsText(file, "UTF-8");
        })(files[i]);
    }
    return fileArr;
}

Number.isInteger = Number.isInteger || function(value) {
  return typeof value === 'number' &&
    isFinite(value) &&
    Math.floor(value) === value;
};