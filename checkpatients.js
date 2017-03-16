/**
 * Created by jakeconway on 2/27/17.
 */

var checkPatients = angular.module("checkPatients", []);

checkPatients.controller("checkPatientsCtrl", function ($scope) {
    $scope.resourceJSON = null;
});

checkPatients.directive("checkPatients", function ($http) {
    return {
        restrict: "A",
        scope: {

        },
        link: link
    };

    function link(scope, element) {
        var el = element[0];
        d3.select(el).append("p").style("margin", "0px").html("Select patient: <br>");
        d3.select(el).selectAll("select").remove();
        var patientInfo = window.location.href.split("?patientInfo=")[1];
        console.log(patientInfo);
        patientInfo = patientInfo.replace(/%22/g, "\"");
        patientInfo = patientInfo.replace(/%7B/g, "{");
        patientInfo = patientInfo.replace(/%7D/g, "}");
        patientInfo = patientInfo.replace(/%5B/g, "[");
        patientInfo = patientInfo.replace(/%5D/g, "]");
        patientInfo = JSON.parse(patientInfo);
        console.log(patientInfo);
        var baseUrl = patientInfo.baseUrl;
        delete patientInfo.baseUrl;
        console.log(baseUrl);
        var patients = Object.keys(patientInfo);

        if (patientInfo.length == 0) {
            return;
        }

        var patientSelect = d3.select(el).append("select")
            .attr("id", "patient-select")
            .style("margin-bottom", "5px");
        var patientOptions = patientSelect.selectAll("patients")
            .data(patients)
            .enter()
            .append("option")
            .attr("value", function (d) {
                return d;
            })
            .html(function (d) {
                return d;
            });

        d3.select(el).append("p").style("margin", "0px").html("Select resoruce: <br>");

        var resourceSelect = d3.select(el).append("select")
            .attr("id", "resource-select")
            .style("margin-bottom", "5px");
        var resourceOptions = resourceSelect.selectAll("resources")
            .data(patientInfo[patients[0]])
            .enter()
            .append("option")
            .attr("value", function(d) {
                return d;
            })
            .html(function(d) {
               return d;
            });

        $("#patient-select").on("change", function() {
            $('#resource-select')
                .find('option')
                .remove()
                .end();
            var patient = $("#patient-select").val();
            resourceSelect.selectAll("resources")
                .data(patientInfo[patient])
                .enter()
                .append("option")
                .attr("value", function(d) {
                    return d;
                })
                .html(function(d) {
                   return d;
                });

            $("#resource-select").val(patientInfo[patient][0]);
            $("#resource-select").trigger("change");
        });

        $("#resource-select").on("change", function () {
            var relativeUrl = this.value;
            $http.get(baseUrl + relativeUrl)
                .then(function (success) {
                        var resourceJSON = syntaxHighlight(JSON.stringify(success.data, undefined, 4));
                        setTimeout(function () {
                            scope.$apply(function () {
                                scope.$parent.resourceJSON = resourceJSON;
                            });
                        }, 50);
                        return;
                    },
                    function (error) {
                        console.log(error);
                    });
        });

        var relativeUrl = $("#resource-select").val();
        $http.get(baseUrl + relativeUrl)
            .then(function (success) {
                    var resourceJSON = syntaxHighlight(JSON.stringify(success.data, undefined, 4));
                    setTimeout(function () {
                        scope.$apply(function () {
                            scope.$parent.resourceJSON = resourceJSON;
                        });
                    }, 50);
                    return;
                },
                function (error) {
                    console.log(error);
                });

    }
});

checkPatients.directive("patientResources", function () {
    return {
        restrict: "A",
        scope: {
            resourcejson: "="
        },
        link: link
    };

    function link(scope, element) {
        var report = scope.report;
        var el = element[0];
        var resourceJSON = scope.resourcejson;

        scope.$watch("resourcejson", function(updatedJSON) {
            d3.select(el).selectAll("div").remove();
            resourceJSON = updatedJSON;
            d3.select(el).append("div").append("pre").node().innerHTML = updatedJSON;
        });
    }
});

function syntaxHighlight(json) {
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        var cls = 'number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'key';
            } else {
                cls = 'string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'boolean';
        } else if (/null/.test(match)) {
            cls = 'null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });
}